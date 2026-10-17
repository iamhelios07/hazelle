import { RISU_DECLINED, RISU_REPLACERS } from '../tool-api/risu-methods';

// RisuAI's v3 plugin API over the public Hazelle tool API (research/risu-plugin-adapter-plan.md §3). Risu's shapes
// live only in this file and it calls nothing but `api`: nothing Risu-shaped crosses tool-api/protocol.ts, so the
// host's contract stays Hazelle's own. A name it does not map yet throws when called; a declined one reads as undefined,
// as on a Risu without it, so a plugin's typeof guard takes its other branch. Either is told to 점검, never passed silently.

type Callback = () => unknown;
type MessageAction = (message: { chatId: string; index: number }) => unknown;
type Replacer = (content: never, type: string) => unknown;
type Handler = (content: string) => unknown;
type Listener = (arg: { char: unknown; chat: unknown; characterIndex: number; chatIndex: number; messageIndex: number }) => unknown;
type Scope = Record<string, unknown>;

// Risu numbers characters and chats by their place in its database; here a stable number of the id stands for it, so
// keys a plugin builds from them stay apart per chat and survive a reload.
const index = (id: string) => {
  let hash = 2166136261;
  for (let at = 0; at < id.length; at++) hash = Math.imul(hash ^ id.charCodeAt(at), 16777619);
  return hash >>> 1;
};

const loreEntry = (entry: Hazelle.LoreEntry) => ({ comment: entry.name, key: entry.keys.join(', '), content: entry.text, alwaysActive: entry.always, disabled: !entry.on });

const character = (card: Hazelle.Card, lorebook: Hazelle.LoreEntry[]) => ({
  chaId: card.id, type: 'character', name: card.name, desc: card.description, personality: card.personality, scenario: card.scenario,
  firstMessage: card.greeting ?? '', creatorNotes: card.creatorNotes, tags: card.tags,
  globalLore: lorebook.filter(({ owner }) => owner.kind === 'character').map(loreEntry),
});

const chatOf = (messages: Hazelle.Message[]) => ({ message: messages.map((message) => ({ role: message.role, data: message.text, time: message.time, chatId: message.id })) });

const MODEL_ROLES = new Set(['system', 'user', 'assistant']);
// A Response with one of these statuses throws when given a body.
const NULL_BODY = new Set([204, 205, 304]);

// Risu's script handler modes on Hazelle's stages, each after the bot's Lua as Risu runs them (processScriptFull):
// display per message shown, output on the reply, input on the message sent, process on each chat message of the request.
const STAGES = { display: 'showing', output: 'replying', input: 'sending', process: 'requesting' } as const;
type Mode = keyof typeof STAGES;

// setup: null with no chat open, which leaves out the keys built from it; the selected persona is then the account's.
type Reads = { account(): Promise<Hazelle.Account>; setup(): Promise<Hazelle.Setup | null>; lorebook(): Promise<Hazelle.LoreEntry[]> };
const persona = async (read: Reads) => {
  const { personas } = await read.account();
  const setup = await read.setup();
  const id = setup ? setup.persona : personas.find(({ current }) => current)?.id;
  return personas.find((each) => each.id === id);
};
// The keys of Risu's database getDatabase builds; any other is told to 점검 and left out, so a plugin's guard on it holds.
const DATABASE: Record<string, (read: Reads) => Promise<unknown>> = {
  username: async (read) => (await persona(read))?.name,
  personaPrompt: async (read) => (await persona(read))?.description,
  personas: async (read) => (await read.account()).personas.map(({ id, name, description }) => ({ id, name, personaPrompt: description })),
  selectedPersona: async (read) => {
    const selected = await persona(read);
    return selected && (await read.account()).personas.indexOf(selected);
  },
  characters: async (read) => (await read.account()).characters.map(({ id, name }) => ({ chaId: id, type: 'character', name })),
  maxContext: async (read) => (await read.setup())?.limits.context ?? undefined,
  maxResponse: async (read) => (await read.setup())?.limits.reply ?? undefined,
  modules: async (read) => {
    const setup = await read.setup();
    const lorebook = setup ? await read.lorebook() : [];
    return setup?.modules.map(({ id, name }) => ({ id, name, lorebook: lorebook.filter(({ owner }) => owner.kind === 'module' && owner.id === id).map(loreEntry) }));
  },
  enabledModules: async (read) => (await read.setup())?.modules.map(({ id }) => id),
};
const once = <T>(read: () => Promise<T>) => {
  let held: Promise<T> | undefined;
  return () => held ??= read();
};

// Installs Risuai, risuai and the dialog shims into scope; answers the frame's stop, which runs onUnload callbacks.
export function installRisu(api: Hazelle.Api, scope: Scope): () => void {
  const frame = api.frame!;
  const told = new Set<string>();
  const tell = (name: string) => { if (told.has(name)) return; told.add(name); frame.missing(name); };
  const refuse = (name: string): never => {
    tell(name);
    throw new Error(`Risu API '${name}' is not available in Hazelle`);
  };
  const buttons = new Map<string, { label: string; run: Callback }>();
  const messageActions = new Map<string, { label: string; run: MessageAction }>();
  // Where each chatId handed out was, as read: a picture often lands after the user moved to another chat, whose messages
  // the frame's chat then reads instead.
  const places = new Map<string, { chat: Hazelle.Chat; at: Hazelle.At }>();
  const place = (chat: Hazelle.Chat, { index, id, version }: Hazelle.At) => places.set(id, { chat, at: { index, id, version } });
  const read = async (chat: Hazelle.Chat) => {
    const messages = await chat.messages();
    for (const message of messages) place(chat, message);
    return chatOf(messages);
  };
  const listedActions = () => [...messageActions].map(([id, { label }]) => ({ id, label }));
  const settings = new Map<string, Callback>();
  const replacers = { beforeRequest: new Set<Replacer>(), afterRequest: new Set<Replacer>() };
  const handlers: Record<Mode, Set<Handler>> = { display: new Set(), output: new Set(), input: new Set(), process: new Set() };
  const listeners = new Set<Listener>();
  const unloads: Callback[] = [];
  // Risu does not await a button or setting; holding the tool's lane for a whole screen would stall its other events.
  const press = (run: Callback | undefined) => { if (run) void Promise.resolve().then(run).catch((error: unknown) => console.error(error)); };

  const opened = async () => {
    const chat = await frame.chat();
    const card = chat && await chat.card();
    return chat && { chat, card, characterIndex: card ? index(card.id) : -1, chatIndex: index(chat.id) };
  };
  const characterOf = async (current: NonNullable<Awaited<ReturnType<typeof opened>>>) => current.card && character(current.card, await current.chat.lorebook());
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
  // nativeFetch over the tool's fetch, which the relay carries: a refusal rejects as a failed fetch does, and the answer
  // is a Response made here, read whole before it is handed over.
  const fetchOf = async (url: string | URL, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') throw new TypeError(`Failed to fetch: Hazelle sends GET and POST only, not ${method}`);
    if (init.body != null && (method === 'GET' || typeof init.body !== 'string')) throw new TypeError('Failed to fetch: Hazelle sends a text body, with POST only');
    const chat = await frame.chat();
    if (!chat) throw new TypeError('Failed to fetch: no chat is open');
    const answer = await chat.fetch(String(url), { method, headers: Object.fromEntries(new Headers(init.headers)), ...(typeof init.body === 'string' && { body: init.body }), ...(init.signal && { signal: init.signal }) });
    if (!answer.ok) throw new TypeError(`Failed to fetch: ${answer.reason}${answer.code ? ` (${answer.code})` : ''}`);
    return new Response(NULL_BODY.has(answer.status) ? null : answer.body, { status: answer.status, headers: answer.headers });
  };
  // The three Risu stores are one synced tool storage here, each under its own prefix so their keys never meet.
  const local = storage('local:');
  const mapped: Scope = {
    getRuntimeInfo: async () => ({ apiVersion: '3.0', platform: 'hazelle', saveMethod: 'account' }),
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
    setArgument: (key: string, value: string | number) => api.setSetting(key, value),
    setArg: (key: string, value: string | number) => api.setSetting(key, value),
    // Risu wraps its main document's elements in SafeClassArray; nothing here hands one out.
    unwarpSafeArray: async (array: unknown[]) => array,
    getDatabase: async (keys: string[] | 'all' = 'all') => {
      const chat = await frame.chat();
      const reads: Reads = { account: once(() => api.account()), setup: once(async () => chat && chat.setup()), lorebook: once(async () => chat ? chat.lorebook() : []) };
      const database: Record<string, unknown> = {};
      for (const key of keys === 'all' ? Object.keys(DATABASE) : keys) {
        if (!Object.hasOwn(DATABASE, key)) { tell(`getDatabase:${key}`); continue; }
        const value = await DATABASE[key]!(reads);
        if (value !== undefined) database[key] = value;
      }
      return database;
    },
    getCurrentLorebookEntries: async () => {
      const chat = await frame.chat();
      return chat ? (await chat.lorebook()).map(loreEntry) : [];
    },
    requestPluginPermission: async () => true,
    getCharacter: async () => { const current = await opened(); return current && characterOf(current); },
    getChar: async () => { const current = await opened(); return current && characterOf(current); },
    getCharacterFromIndex: async (characterIndex: number) => {
      const current = await opened();
      return current && current.characterIndex === characterIndex ? characterOf(current) : null;
    },
    getCurrentCharacterIndex: async () => (await opened())?.characterIndex ?? -1,
    getCurrentChatIndex: async () => (await opened())?.chatIndex ?? -1,
    getChatFromIndex: async (characterIndex: number, chatIndex: number) => {
      const chat = await at(characterIndex, chatIndex);
      return chat && read(chat);
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
    addRisuReplacer: async (type: string, replacer: Replacer) => {
      if (!RISU_REPLACERS.has(type)) refuse(`addRisuReplacer:${type}`);
      replacers[type as keyof typeof replacers].add(replacer);
      listen(type === 'beforeRequest' ? 'requesting' : 'replying');
    },
    removeRisuReplacer: async (type: string, replacer: Replacer) => { replacers[type as keyof typeof replacers]?.delete(replacer); },
    addRisuScriptHandler: async (mode: string, handler: Handler) => {
      if (!Object.hasOwn(STAGES, mode)) refuse(`addRisuScriptHandler:${mode}`);
      handlers[mode as Mode].add(handler);
      listen(STAGES[mode as Mode]);
    },
    removeRisuScriptHandler: async (mode: string, handler: Handler) => { handlers[mode as Mode]?.delete(handler); },
    addRisuChatListener: async (_mode: 'output', listener: Listener) => { listeners.add(listener); },
    removeRisuChatListener: async (_mode: 'output', listener: Listener) => { listeners.delete(listener); },
    // Risu's paths for what saveAsset keeps, assets/<hash>.png, over the tool's assets; readImage refuses other folders as
    // Risu does, and answers null for a path this module never saved, a Risu path of the bot's own pictures included.
    saveAsset: async (data: Uint8Array) => `assets/${await api.assets.save(data)}.png`,
    readImage: async (path: string) => {
      const name = path.startsWith('assets/') ? path.slice('assets/'.length) : path;
      if (name.includes('/') || name.includes('\\')) throw new Error('readImage path cannot contain \'/\' or \'\\\', except the assets/ prefix');
      return name.endsWith('.png') ? api.assets.read(name.slice(0, -'.png'.length)) : null;
    },
    nativeFetch: fetchOf,
    // Risu's globalFetch: a JSON body, POST unless told, and an envelope holding the parsed JSON, or the bytes with
    // rawResponse; any failure, an unreadable JSON answer included, is its { ok: false, data: message, status: 400 }.
    risuFetch: async (url: string, arg: { body?: unknown; headers?: Record<string, string>; method?: 'GET' | 'POST'; rawResponse?: boolean; abortSignal?: AbortSignal } = {}) => {
      try {
        const response = await fetchOf(url, { method: arg.method ?? 'POST', headers: { 'Content-Type': 'application/json', ...arg.headers }, body: JSON.stringify(arg.body), signal: arg.abortSignal ?? null });
        const data: unknown = arg.rawResponse ? new Uint8Array(await response.arrayBuffer()) : await response.json();
        return { ok: response.ok, data, headers: Object.fromEntries(response.headers), status: response.status };
      } catch (error) {
        return { ok: false, data: String(error), headers: {}, status: 400 };
      }
    },
  };
  const risu = new Proxy(mapped, {
    get: (target, name) => {
      if (typeof name === 'symbol' || name === 'then') return undefined;
      if (Object.hasOwn(target, name)) return target[name];
      if (!RISU_DECLINED.has(name)) return async () => refuse(name);
      tell(name);
      return undefined;
    },
  });

  // Risu's handlers answer null or undefined to leave the text as it is.
  const edited = async (mode: Mode, text: string) => {
    let content = text;
    for (const handler of [...handlers[mode]]) {
      const next = await handler(content);
      if (next === null || next === undefined) continue;
      if (typeof next !== 'string') throw new Error(`Risu ${mode} script handler answered no text`);
      content = next;
    }
    return content;
  };
  // Only the chat's own request and reply pass these stages, so Risu's request type is always 'model'.
  const stages: { [E in (typeof STAGES)[Mode]]: Hazelle.Events[E] } = {
    replying: async (_chat, text) => {
      let content = text;
      for (const replacer of [...replacers.afterRequest]) {
        const next = await replacer(content as never, 'model');
        if (typeof next === 'string') content = next;
      }
      return edited('output', content);
    },
    sending: (_chat, text) => edited('input', text),
    requesting: async (_chat, messages) => {
      const processed: Hazelle.RequestMessage[] = [];
      for (const message of messages) processed.push(message.message === undefined ? message : { ...message, content: await edited('process', message.content) });
      if (!replacers.beforeRequest.size) return processed;
      let risu: unknown = processed.map(({ role, content, message, cache }) => ({ role, content, ...(message !== undefined && { memo: message }), ...(cache && { cachePoint: true }) }));
      for (const replacer of [...replacers.beforeRequest]) risu = await replacer(risu as never, 'model');
      return fromRisu(risu, new Set(messages.flatMap(({ message }) => message ?? [])));
    },
    showing: async (_chat, shown) => {
      const texts: string[] = [];
      for (const { text } of shown) texts.push(await edited('display', text));
      return texts;
    },
  };
  // What a replacer answers is sent only as Hazelle can send it: a message it cannot fails the stage, which sends the
  // request as it came; a field it cannot carry is told to 점검.
  const fromRisu = (answer: unknown, ids: Set<string>): Hazelle.RequestMessage[] => {
    if (!Array.isArray(answer)) throw new Error('Risu beforeRequest replacer answered no message list');
    return answer.map((message: unknown) => {
      const { role, content, memo, cachePoint, ...rest } = (message ?? {}) as Record<string, unknown>;
      if (typeof role !== 'string' || !MODEL_ROLES.has(role) || typeof content !== 'string') throw new Error(`Risu beforeRequest replacer answered a message Hazelle cannot send (role ${String(role)})`);
      for (const [key, value] of Object.entries(rest)) if (value !== undefined) tell(`addRisuReplacer:beforeRequest.${key}`);
      return { role: role as Hazelle.RequestMessage['role'], content, ...(typeof memo === 'string' && ids.has(memo) && { message: memo }), ...(cachePoint === true && { cache: true as const }) };
    });
  };
  // A stage is listened to once a hook needs it, so a chat waits on no plugin that has none (the host learns of a
  // listener added after load).
  const listening = new Set<keyof typeof stages>();
  const listen = (stage: keyof typeof stages) => {
    if (listening.has(stage)) return;
    listening.add(stage);
    api.on(stage, stages[stage] as never);
  };

  api.on('menu', (_chat, item) => press(buttons.get(item)?.run));
  api.on('action', (chat, item, message) => {
    const action = messageActions.get(item);
    if (!action) return;
    place(chat, message);
    press(() => action.run({ chatId: message.id, index: message.index }));
  });
  api.on('open', () => press(settings.values().next().value));
  api.on('reply', async (chat, reply) => {
    if (!listeners.size) return;
    const card = await chat.card();
    const arg = { char: card && character(card, await chat.lorebook()), chat: await read(chat), characterIndex: card ? index(card.id) : -1, chatIndex: index(chat.id), messageIndex: reply.index };
    for (const listener of [...listeners]) await listener(arg);
  });

  scope.Risuai = risu;
  scope.risuai = risu;
  // PluginSlots, version 1 (research/risu-plugin-adapter-plan.md §9): what a ported plugin calls where it would touch
  // Risu's page, which a piece pasted into the plugin fills on Risu. It is not Risu's, so it maps over the Hazelle API
  // here like the rest, and never through Risuai. A message is named by the chatId Risu's chat reads carry.
  scope.PluginSlots = {
    version: 1,
    // On the version read when its chatId was handed out, which the picture was made for.
    attachPicture: async (chatId: string, bytes: Uint8Array, options: { caption?: string } = {}) => {
      const at = places.get(chatId);
      if (!at) throw new Error(`PluginSlots.attachPicture: no chat read here has message ${chatId}`);
      await at.chat.picture(at.at, bytes, options);
    },
    registerMessageAction: async ({ id, label }: { id: string; label: string }, callback: MessageAction) => {
      const previous = messageActions.get(id);
      messageActions.set(id, { label, run: callback });
      try {
        await frame.actions(listedActions());
      } catch (error) {
        if (previous) messageActions.set(id, previous);
        else messageActions.delete(id);
        throw error;
      }
    },
    removeMessageAction: async (id: string) => { if (messageActions.delete(id)) await frame.actions(listedActions()); },
  };
  // Hazelle's sandbox has no allow-modals. alert becomes the tool's say; confirm and prompt answer at once, so they
  // cannot be mapped and are only told to 점검.
  scope.alert = (message?: unknown) => { void frame.chat().then((chat) => chat ? chat.say(String(message)) : console.log(message)); };
  for (const name of ['confirm', 'prompt'] as const) {
    const native = scope[name] as (...args: unknown[]) => unknown;
    scope[name] = (...args: unknown[]) => { tell(name); return native(...args); };
  }
  return () => { for (const unload of unloads) press(unload); };
}
