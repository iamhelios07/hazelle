import type { Json, Settings } from '../tool-api/manifest';
import type { ChatHeader, Down, EventName, Message, Method, Port, ToolOutcome, Up } from '../tool-api/protocol';

type Load = Extract<Down, { kind: 'load' }>;
type Buffer = { writes: Map<string, Json | undefined>; edits: Map<number, string>; added: ToolOutcome['added'] };
const buffer = (): Buffer => ({ writes: new Map(), edits: new Map(), added: [] });
const outcome = (pending: Buffer, value?: string | null): ToolOutcome => ({ value, writes: [...pending.writes], edits: [...pending.edits].map(([index, text]) => ({ index, text })), added: pending.added });
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
      if (!pageWrites.writes.size && !pageWrites.edits.size && !pageWrites.added.length) return;
      const pending = pageSent = pageWrites;
      pageWrites = buffer();
      send({ kind: 'done', id: 0, outcome: outcome(pending) });
    });
  };

  const chatOf = (header: ChatHeader, event?: number, writes = buffer()): Hazelle.Chat => {
    const pending = () => event === undefined ? pageWrites : writes;
    const changed = () => { if (event === undefined) flushPage(); };
    return {
      ...header,
      messages: async (from, to) => {
        const tail = await call<{ from: number; items: Message[] }>('chat.messages', [], event);
        history = [...history.slice(0, tail.from), ...tail.items];
        return history.slice(from, to);
      },
      state: {
        get: async <T extends Json>(key: string): Promise<T | undefined> => {
          const current = pending().writes;
          if (current.has(key)) return current.get(key) as T | undefined;
          if (event === undefined && pageSent?.writes.has(key)) return pageSent.writes.get(key) as T | undefined;
          return call<T | undefined>('chat.state.get', [key], event);
        },
        set: (key, value) => { pending().writes.set(key, value); changed(); },
        delete: (key) => { pending().writes.set(key, undefined); changed(); },
      },
      edit: (index, text) => { pending().edits.set(index, text); changed(); },
      add: (role, text) => { pending().added.push({ role, text }); changed(); },
      model: (role, messages) => call('model', [role, messages], event),
      tokens: (text) => call('tokens', [text], event),
      lore: (reserve) => call('lore', [reserve ?? null], event),
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
        post: (data) => fire('post', [data]),
        page: data.role === 'page' ? { chat: data.chat && chatOf(data.chat), theme: data.theme, close: () => fire('page.close', []) } : null,
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
    if (data.kind === 'event') {
      const pending = buffer();
      const chat = data.chat && chatOf(data.chat, data.id, pending);
      const args = data.event === 'reply' ? [chat, data.reply] : data.event === 'menu' ? [chat, data.item] : [chat];
      void dispatch(data.event, args).then((value) => send({ kind: 'done', id: data.id, outcome: outcome(pending, typeof value === 'string' ? value : null) }), (error: unknown) => failed(data.id, error));
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
