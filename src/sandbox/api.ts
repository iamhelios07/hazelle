import type { Json, Settings } from '../tool-api/manifest';
import type { ChatHeader, Down, EventName, Message, Method, Port, ToolOutcome, Up } from '../tool-api/protocol';

type Load = Extract<Down, { kind: 'load' }>;
type Buffer = { writes: Map<string, Json | undefined>; edits: Map<number, string>; added: ToolOutcome['added']; data: Map<string, Json | undefined>; badges: Map<number, string | null> };
const buffer = (): Buffer => ({ writes: new Map(), edits: new Map(), added: [], data: new Map(), badges: new Map() });
const empty = (pending: Buffer) => !pending.writes.size && !pending.edits.size && !pending.added.length && !pending.data.size && !pending.badges.size;
const outcome = (pending: Buffer, value?: ToolOutcome['value']): ToolOutcome => ({
  value, writes: [...pending.writes], edits: [...pending.edits].map(([index, text]) => ({ index, text })), added: pending.added,
  data: [...pending.data], badges: [...pending.badges].map(([index, text]) => ({ index, text })),
});
// An event about the user's own change must not rewrite the story under them, nor one inside a turn or a showing.
const STORY_LOCKED = new Set<EventName>(['change', 'branch', 'replying', 'sending', 'requesting', 'showing']);
// Nothing a showing answers is saved, so a write there would be lost.
const QUIET = new Set<EventName>(['showing']);
const ANSWERS = new Set<EventName>(['replying', 'sending', 'requesting', 'showing']);
const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

export function connectApi(port: Port, execute: (code: string, api: Hazelle.Api) => void | Promise<void>): () => void {
  let load: Load | null = null;
  let calls = 0;
  let closed = false;
  let loaded = false;
  let history: Message[] = [];
  let pageWrites = buffer();
  let pageFlush = false;
  let pageSent: Buffer | null = null;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const handlers = new Map<EventName, ((...args: never[]) => unknown)[]>();
  const storageListeners = new Set<(keys: string[]) => void>();
  const send = (message: Up) => { if (!closed) port.postMessage(message); };
  const call = <T>(method: Method, args: unknown[], event?: number): Promise<T> => {
    if (closed) return Promise.reject(new Error('closed'));
    const id = ++calls;
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: (value) => resolve(value as T), reject });
      send({ kind: 'call', call: id, method, args, ...(event === undefined ? {} : { event }) });
    });
  };
  const fire = (method: Method, args: unknown[], event?: number) => { void call(method, args, event).catch(() => {}); };
  const flushPage = () => {
    if (pageFlush || pageSent) return;
    pageFlush = true;
    queueMicrotask(() => {
      pageFlush = false;
      if (empty(pageWrites)) return;
      const pending = pageSent = pageWrites;
      pageWrites = buffer();
      send({ kind: 'done', id: 0, outcome: outcome(pending) });
    });
  };

  const chatOf = (header: ChatHeader, event?: number, writes = buffer(), locked = false, quiet = false): Hazelle.Chat => {
    const pending = () => { if (quiet) throw new Error('Nothing is saved in this event'); return event === undefined ? pageWrites : writes; };
    const changed = () => { if (event === undefined) flushPage(); };
    const story = () => { if (locked) throw new Error('The story cannot be changed in this event'); };
    const overlaid = async <T extends Json>(layer: 'writes' | 'data', method: 'chat.state.get' | 'chat.data.get', key: string): Promise<T | undefined> => {
      const current = (event === undefined ? pageWrites : writes)[layer];
      if (current.has(key)) return current.get(key) as T | undefined;
      if (event === undefined && pageSent?.[layer].has(key)) return pageSent[layer].get(key) as T | undefined;
      return call<T | undefined>(method, [key], event);
    };
    return {
      ...header,
      messages: async (from, to) => {
        const tail = await call<{ from: number; items: Message[] }>('chat.messages', [], event);
        history = [...history.slice(0, tail.from), ...tail.items];
        return history.slice(from, to);
      },
      greeting: () => call<string | null>('chat.greeting', [], event),
      card: () => call<Hazelle.Card | null>('chat.card', [], event),
      state: {
        get: <T extends Json>(key: string) => overlaid<T>('writes', 'chat.state.get', key),
        set: (key, value) => { pending().writes.set(key, value); changed(); },
        delete: (key) => { pending().writes.set(key, undefined); changed(); },
      },
      data: {
        get: <T extends Json>(key: string) => overlaid<T>('data', 'chat.data.get', key),
        set: (key, value) => { pending().data.set(key, value); changed(); },
        delete: (key) => { pending().data.set(key, undefined); changed(); },
        keys: async () => {
          const keys = new Set(await call<string[]>('chat.data.keys', [], event));
          for (const layer of [...(event === undefined && pageSent ? [pageSent.data] : []), pending().data]) {
            for (const [key, value] of layer) {
              if (value === undefined) keys.delete(key);
              else keys.add(key);
            }
          }
          return [...keys];
        },
      },
      edit: (index, text) => { story(); pending().edits.set(index, text); changed(); },
      add: (role, text) => { story(); pending().added.push({ role, text }); changed(); },
      model: (role, messages) => call('model', [role, messages], event),
      embed: (texts, as) => call('embed', [texts, as ?? null], event),
      badge: (index, text) => { pending().badges.set(index, text); changed(); },
      tokens: (text) => call('tokens', [text], event),
      lore: (reserve) => call('lore', [reserve ?? null], event),
      lorebook: () => call('chat.lorebook', [], event),
      setup: () => call('chat.setup', [], event),
      ask: (question) => call('ask', [question], event),
      say: (text, tone = 'normal') => fire('say', [tone, text], event),
    };
  };

  const dispatch = async (event: EventName, args: unknown[]) => {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) result = await handler(...args as never[]);
    return result;
  };
  const failed = (id: number, error: unknown) => send({ kind: 'failed', id, message: describe(error) });

  port.onmessage = ({ data }: MessageEvent<Down>) => {
    if (closed) return;
    if (data.kind === 'ping') return send({ kind: 'pong' });
    if (data.kind === 'answer') {
      // Call zero acknowledges a page flush; keep its overlay until the host has applied the write.
      if (data.call === 0 && pageSent) {
        pageSent = null;
        if (!data.ok) failed(0, data.value);
        flushPage();
        return;
      }
      const waiter = waiting.get(data.call);
      if (!waiter) return;
      waiting.delete(data.call);
      if (data.ok) waiter.resolve(data.value);
      else waiter.reject(new Error(String(data.value)));
      return;
    }
    if (data.kind === 'load') {
      if (load) return;
      load = data;
      const api: Hazelle.Api = {
        api: 1,
        tool: { name: data.manifest.name, author: data.manifest.author, displayName: data.manifest.displayName, version: data.manifest.version },
        context: data.role,
        on: (event, handler) => {
          if (data.role === 'page' && event !== 'message') throw new Error('Only message listeners run on a page');
          const list = handlers.get(event) ?? [];
          handlers.set(event, [...list, handler as (...args: never[]) => unknown]);
          if (loaded) send({ kind: 'loaded', listens: [...handlers.keys()] });
        },
        storage: {
          get: (key) => call('storage.get', [key]),
          set: (key, value) => call('storage.set', [key, value]),
          delete: (key) => call('storage.delete', [key]),
          keys: () => call('storage.keys', []),
          onChange: (listener) => { storageListeners.add(listener); return () => { storageListeners.delete(listener); }; },
        },
        settings: () => call<Settings>('settings', []),
        setSetting: (key, value) => call('settings.set', [key, value]),
        account: () => call('account', []),
        post: (data) => fire('post', [data]),
        page: data.role === 'page' ? { chat: data.chat && chatOf(data.chat), theme: data.theme, close: () => fire('page.close', []) } : null,
        frame: data.role === 'frame' ? {
          chat: async () => { const header = await call<ChatHeader | null>('frame.chat', []); return header && chatOf(header); },
          show: () => fire('frame.show', []),
          hide: () => fire('frame.hide', []),
          menu: (items) => fire('frame.menu', [items]),
          missing: (name) => fire('frame.missing', [name]),
        } : null,
      };
      void Promise.resolve().then(() => execute(data.code, api)).then(() => {
        loaded = true;
        send({ kind: 'loaded', listens: [...handlers.keys()] });
      }, (error: unknown) => send({ kind: 'load-failed', message: describe(error) }));
      return;
    }
    if (!load) return;
    if (data.kind === 'storage') {
      for (const listener of storageListeners) void Promise.resolve().then(() => listener(data.keys)).catch((error: unknown) => failed(0, error));
      return;
    }
    if (data.kind === 'message') { void dispatch('message', [data.data]).catch((error: unknown) => failed(0, error)); return; }
    if (data.kind === 'settings') { void dispatch('settings', [data.values]).catch((error: unknown) => failed(0, error)); return; }
    if (data.kind === 'open') { void dispatch('open', []).catch((error: unknown) => failed(0, error)); return; }
    if (data.kind === 'event') {
      const pending = buffer();
      const chat = data.chat && chatOf(data.chat, data.id, pending, STORY_LOCKED.has(data.event), QUIET.has(data.event));
      const args = {
        reply: [chat, data.reply], replying: [chat, data.text], sending: [chat, data.text], requesting: [chat, data.messages], showing: [chat, data.shown], prompt: [chat, data.turn],
        change: [chat, data.change], branch: [chat, data.from], menu: [chat, data.item], action: [chat, data.item, data.message],
      }[data.event as string] ?? [chat];
      const answer = (value: unknown) => data.event === 'prompt' ? (value as Hazelle.PromptAnswer | undefined) ?? null : ANSWERS.has(data.event) && value !== null ? value as ToolOutcome['value'] : undefined;
      // The host checks the answer's shape; one the port cannot carry fails the event here.
      void dispatch(data.event, args).then((value) => send({ kind: 'done', id: data.id, outcome: outcome(pending, answer(value)) })).catch((error: unknown) => failed(data.id, error));
    }
  };
  port.start();
  return () => {
    closed = true;
    port.onmessage = null;
    port.close();
    for (const waiter of waiting.values()) waiter.reject(new Error('closed'));
    waiting.clear();
    storageListeners.clear();
    handlers.clear();
  };
}
