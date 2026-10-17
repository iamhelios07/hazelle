import { RISU_DECLINED, RISU_REPLACERS } from '../tool-api/risu-methods';

// RisuAI's v3 plugin API over the public Hazelle tool API (research/risu-plugin-adapter-plan.md §3). Risu's shapes
// live only in this file and it calls nothing but `api`: nothing Risu-shaped crosses tool-api/protocol.ts, so the
// host's contract stays Hazelle's own. A name it does not map throws and is told to 점검, never answered silently.

type Callback = () => unknown;
type Replacer = (content: string, type: string) => unknown;
type Listener = (arg: { char: unknown; chat: unknown; characterIndex: number; chatIndex: number; messageIndex: number }) => unknown;
type Scope = Record<string, unknown>;

// Risu numbers characters and chats by their place in its database; here a stable number of the id stands for it, so
// keys a plugin builds from them stay apart per chat and survive a reload.
const index = (id: string) => {
  let hash = 2166136261;
  for (let at = 0; at < id.length; at++) hash = Math.imul(hash ^ id.charCodeAt(at), 16777619);
  return hash >>> 1;
};

const character = (card: Hazelle.Card) => ({
  chaId: card.id, type: 'character', name: card.name, desc: card.description, personality: card.personality, scenario: card.scenario,
  firstMessage: card.greeting ?? '', creatorNotes: card.creatorNotes, tags: card.tags,
  globalLore: card.lore.map((entry) => ({ comment: entry.name, key: entry.keys.join(', '), content: entry.text, alwaysActive: entry.always, disabled: !entry.on })),
});

const chatOf = async (chat: Hazelle.Chat) => ({ message: (await chat.messages()).map((message) => ({ role: message.role, data: message.text, time: message.time, chatId: message.id })) });

const MODEL_ROLES = new Set(['system', 'user', 'assistant']);

// Installs Risuai, risuai and the dialog shims into scope; answers the frame's stop, which runs onUnload callbacks.
export function installRisu(api: Hazelle.Api, scope: Scope): () => void {
  const frame = api.frame!;
  const told = new Set<string>();
  const tell = (name: string) => { if (told.has(name)) return; told.add(name); frame.missing(name); };
  const refuse = (name: string): never => {
    tell(name);
    throw new Error(RISU_DECLINED.has(name) ? `Risu API '${name}' is declined in Hazelle` : `Risu API '${name}' is not available in Hazelle`);
  };
  const buttons = new Map<string, { label: string; run: Callback }>();
  const settings = new Map<string, Callback>();
  const replacers = new Set<Replacer>();
  const listeners = new Set<Listener>();
  const unloads: Callback[] = [];
  // Risu does not await a button or setting; holding the tool's lane for a whole screen would stall its other events.
  const press = (run: Callback | undefined) => { if (run) void Promise.resolve().then(run).catch((error: unknown) => console.error(error)); };

  const opened = async () => {
    const chat = await frame.chat();
    const card = chat && await chat.card();
    return chat && { chat, card, characterIndex: card ? index(card.id) : -1, chatIndex: index(chat.id) };
  };
  const at = async (characterIndex: number, chatIndex: number) => {
    const current = await opened();
    return current && current.characterIndex === characterIndex && current.chatIndex === chatIndex ? current.chat : null;
  };
  const storage = (prefix: string) => {
    const keys = async () => (await api.storage.keys()).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
    return {
      getItem: async (key: string) => (await api.storage.get(prefix + key)) ?? null,
      setItem: (key: string, value: Hazelle.Json) => api.storage.set(prefix + key, value),
      removeItem: (key: string) => api.storage.delete(prefix + key),
      keys,
      clear: async () => { for (const key of await keys()) await api.storage.delete(prefix + key); },
      key: async (at: number) => (await keys())[at] ?? null,
      length: async () => (await keys()).length,
    };
  };
  // The three Risu stores are one synced tool storage here, each under its own prefix so their keys never meet.
  const local = storage('local:');
  const mapped: Scope = {
    showContainer: async () => frame.show(),
    hideContainer: async () => frame.hide(),
    registerButton: async (arg: { name: string; id?: string }, callback: Callback) => {
      const id = arg.id ?? crypto.randomUUID();
      buttons.set(id, { label: arg.name, run: callback });
      frame.menu([...buttons].map(([id, { label }]) => ({ id, label })));
      return { id };
    },
    registerSetting: async (_name: string, callback: Callback, _icon?: string, _iconType?: string, id = crypto.randomUUID()) => {
      settings.set(id, callback);
      return { id };
    },
    unregisterUIPart: async (id: string) => {
      settings.delete(id);
      if (buttons.delete(id)) frame.menu([...buttons].map(([id, { label }]) => ({ id, label })));
    },
    onUnload: async (callback: Callback) => { unloads.push(callback); },
    log: async (message: string) => console.log(message),
    pluginStorage: storage('plugin:'),
    getLocalPluginStorage: async () => local,
    safeLocalStorage: storage('safe:'),
    getArgument: async (key: string) => (await api.settings())[key],
    getArg: async (key: string) => (await api.settings())[key],
    requestPluginPermission: async () => true,
    getCharacter: async () => { const card = (await opened())?.card; return card ? character(card) : null; },
    getChar: async () => { const card = (await opened())?.card; return card ? character(card) : null; },
    getCurrentCharacterIndex: async () => (await opened())?.characterIndex ?? -1,
    getCurrentChatIndex: async () => (await opened())?.chatIndex ?? -1,
    getChatFromIndex: async (characterIndex: number, chatIndex: number) => {
      const chat = await at(characterIndex, chatIndex);
      return chat && chatOf(chat);
    },
    setChatToIndex: async (characterIndex: number, chatIndex: number, value: { message: { role: string; data: string }[] }) => {
      const chat = await at(characterIndex, chatIndex);
      if (!chat) throw new Error('Risu API \'setChatToIndex\' reaches only the open chat in Hazelle');
      const messages = await chat.messages();
      if (value.message.length < messages.length) throw new Error('Risu API \'setChatToIndex\' cannot remove messages in Hazelle');
      value.message.forEach((message, at) => {
        if (at >= messages.length) chat.add(message.role === 'user' ? 'user' : 'char', message.data);
        else if (message.data !== messages[at]!.text) chat.edit(at, message.data);
      });
    },
    runLLMModel: async ({ messages, mode, staticModel }: { messages: { role: string; content: unknown }[]; mode: string; staticModel?: string }) => {
      if (staticModel !== undefined) return { type: 'fail', result: 'staticModel is not available in Hazelle' };
      if (!messages.every((message) => MODEL_ROLES.has(message.role) && typeof message.content === 'string')) return { type: 'fail', result: 'only system, user and assistant text messages are sent' };
      const chat = await frame.chat();
      if (!chat) return { type: 'fail', result: 'no chat is open' };
      const answer = await chat.model(mode === 'model' ? 'main' : 'aux', messages as Hazelle.ModelMessage[]);
      return answer.ok ? { type: 'success', result: answer.text } : { type: 'fail', result: answer.reason };
    },
    addRisuReplacer: async (type: string, replacer: Replacer) => { if (!RISU_REPLACERS.has(type)) refuse(`addRisuReplacer:${type}`); replacers.add(replacer); },
    removeRisuReplacer: async (_type: string, replacer: Replacer) => { replacers.delete(replacer); },
    addRisuChatListener: async (_mode: 'output', listener: Listener) => { listeners.add(listener); },
    removeRisuChatListener: async (_mode: 'output', listener: Listener) => { listeners.delete(listener); },
  };
  const risu = new Proxy(mapped, {
    get: (target, name) => {
      if (typeof name === 'symbol' || name === 'then') return undefined;
      return Object.hasOwn(target, name) ? target[name] : async () => refuse(name);
    },
  });

  // Every event the adapter serves is listened to before the plugin runs: the host takes the list once, at load, and a
  // plugin registers its hooks after awaits.
  api.on('menu', (_chat, item) => press(buttons.get(item)?.run));
  api.on('open', () => press(settings.values().next().value));
  // afterRequest: Risu's request type, which here is always the chat's own reply.
  api.on('replying', async (_chat, text) => {
    let content = text;
    for (const replacer of [...replacers]) {
      const next = await replacer(content, 'model');
      if (typeof next === 'string') content = next;
    }
    return content;
  });
  api.on('reply', async (chat, reply) => {
    if (!listeners.size) return;
    const card = await chat.card();
    const arg = { char: card && character(card), chat: await chatOf(chat), characterIndex: card ? index(card.id) : -1, chatIndex: index(chat.id), messageIndex: reply.index };
    for (const listener of [...listeners]) await listener(arg);
  });

  scope.Risuai = risu;
  scope.risuai = risu;
  // Hazelle's sandbox has no allow-modals. alert becomes the tool's say; confirm and prompt answer at once, so they
  // cannot be mapped and are only told to 점검.
  scope.alert = (message?: unknown) => { void frame.chat().then((chat) => chat ? chat.say(String(message)) : console.log(message)); };
  for (const name of ['confirm', 'prompt'] as const) {
    const native = scope[name] as (...args: unknown[]) => unknown;
    scope[name] = (...args: unknown[]) => { tell(name); return native(...args); };
  }
  return () => { for (const unload of unloads) press(unload); };
}
