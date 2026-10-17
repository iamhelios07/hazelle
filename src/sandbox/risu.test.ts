import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { RISU_MAPPED } from '../tool-api/risu-methods';
import { installRisu } from './risu';

type Handler = (...args: never[]) => unknown;

function fakeApi({ open = true } = {}) {
  const handlers = new Map<string, Handler>();
  const storage = new Map<string, Hazelle.Json>();
  const menus: { id: string; label: string }[][] = [];
  const missing: string[] = [];
  const edits: [number, string][] = [];
  const added: [Hazelle.Role, string][] = [];
  const said: string[] = [];
  const messages: Hazelle.Message[] = [
    { index: 0, id: 'm0', version: 'v0', role: 'user', text: 'hello', time: 1 },
    { index: 1, id: 'm1', version: 'v1', role: 'char', text: 'hi there', time: 2 },
  ];
  const card: Hazelle.Card = {
    id: 'character-1', name: 'Mira', description: 'A sailor', personality: 'calm', scenario: 'harbor', greeting: null, creatorNotes: '', tags: ['sea'],
    lore: [{ name: 'Port', keys: ['port', 'dock'], text: 'The port.', always: false, on: true }],
  };
  const model = vi.fn<Hazelle.Chat['model']>(async () => ({ ok: true, text: 'made' }));
  const chat = {
    id: 'chat-1', character: { name: 'Mira', description: 'A sailor' }, persona: null, length: messages.length,
    messages: async () => messages, greeting: async () => null, card: async () => card,
    edit: (index: number, text: string) => { edits.push([index, text]); }, add: (role: Hazelle.Role, text: string) => { added.push([role, text]); },
    model, say: (text: string) => { said.push(text); },
  } as unknown as Hazelle.Chat;
  const api = {
    api: 1, tool: { name: 'test', author: 'jin', displayName: 'Test', version: '1' }, context: 'frame',
    on: (event: string, handler: Handler) => { handlers.set(event, handler); },
    storage: {
      get: async (key: string) => storage.get(key), set: async (key: string, value: Hazelle.Json) => { storage.set(key, value); },
      delete: async (key: string) => { storage.delete(key); }, keys: async () => [...storage.keys()], onChange: () => () => {},
    },
    settings: async () => ({ image_base: 'none' }), post: () => {}, page: null,
    frame: { chat: async () => (open ? chat : null), show: vi.fn(), hide: vi.fn(), menu: (items: { id: string; label: string }[]) => { menus.push(items); }, missing: (name: string) => { missing.push(name); } },
  } as unknown as Hazelle.Api;
  const fire = (event: string, ...args: unknown[]) => (handlers.get(event) as (...args: unknown[]) => unknown)(...args);
  return { api, chat, card, handlers, storage, menus, missing, edits, added, said, model, fire };
}
const install = (fake: ReturnType<typeof fakeApi>, scope: Record<string, unknown> = { confirm: () => false, prompt: () => null }) => {
  installRisu(fake.api, scope);
  return scope as Record<string, unknown> & { Risuai: Record<string, (...args: never[]) => Promise<unknown>> & Record<string, Record<string, (...args: never[]) => Promise<unknown>>> };
};

describe('the Risu adapter', () => {
  it('names the open chat by stable indices that getChatFromIndex answers, and nothing else', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const characterIndex = await Risuai.getCurrentCharacterIndex!() as number;
    const chatIndex = await Risuai.getCurrentChatIndex!() as number;
    expect(Number.isSafeInteger(characterIndex) && characterIndex >= 0).toBe(true);
    expect(await Risuai.getChatFromIndex!(characterIndex as never, chatIndex as never)).toEqual({ message: [{ role: 'user', data: 'hello', time: 1, chatId: 'm0' }, { role: 'char', data: 'hi there', time: 2, chatId: 'm1' }] });
    expect(await Risuai.getChatFromIndex!(characterIndex as never, (chatIndex + 1) as never)).toBeNull();
    await Risuai.setChatToIndex!(characterIndex as never, chatIndex as never, { message: [{ role: 'user', data: 'hello' }, { role: 'char', data: 'edited' }, { role: 'user', data: 'more' }] } as never);
    expect(fake.edits).toEqual([[1, 'edited']]);
    expect(fake.added).toEqual([['user', 'more']]);
    expect(await Risuai.getCharacter!()).toMatchObject({ chaId: 'character-1', name: 'Mira', desc: 'A sailor', firstMessage: '', type: 'character', globalLore: [{ key: 'port, dock', content: 'The port.' }] });

    const closed = install(fakeApi({ open: false })).Risuai;
    expect(await closed.getCurrentChatIndex!()).toBe(-1);
    expect(await closed.getChatFromIndex!(-1 as never, -1 as never)).toBeNull();
    expect(await closed.getCharacter!()).toBeNull();
  });

  it('relabels a button registered again under its id and runs the latest callback when pressed', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const first = vi.fn();
    const second = vi.fn();
    await Risuai.registerButton!({ name: '낚시하기', id: 'cast' } as never, first as never);
    await Risuai.registerButton!({ name: '낚시하기 (새 업적 1)', id: 'cast' } as never, second as never);
    expect(fake.menus.at(-1)).toEqual([{ id: 'cast', label: '낚시하기 (새 업적 1)' }]);
    fake.fire('menu', fake.chat, 'cast');
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
    await Risuai.unregisterUIPart!('cast' as never);
    expect(fake.menus.at(-1)).toEqual([]);
  });

  it('maps exactly the shared list; any other name throws by name and is told to 점검 once', async () => {
    const fake = fakeApi();
    const scope = install(fake);
    const { Risuai } = scope;
    for (const name of RISU_MAPPED) expect(Risuai[name], name).toBeDefined();
    await expect(Risuai.getDatabase!()).rejects.toThrow("Risu API 'getDatabase' is not available in Hazelle");
    await expect(Risuai.getDatabase!()).rejects.toThrow();
    await expect(Risuai.getRootDocument!()).rejects.toThrow("Risu API 'getRootDocument' is declined in Hazelle");
    await expect(Risuai.addRisuReplacer!('beforeRequest' as never, (() => []) as never)).rejects.toThrow("'addRisuReplacer:beforeRequest'");
    expect((Risuai as Record<string, unknown>).then).toBeUndefined();
    (scope.confirm as () => boolean)();
    (scope.confirm as () => boolean)();
    expect(fake.missing).toEqual(['getDatabase', 'getRootDocument', 'addRisuReplacer:beforeRequest', 'confirm']);
  });

  it('chains afterRequest replacers over the reply and answers runLLMModel in Risu shape', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    await Risuai.addRisuReplacer!('afterRequest' as never, ((content: string, type: string) => `${content} [${type}]`) as never);
    await Risuai.addRisuReplacer!('afterRequest' as never, (async (content: string) => content.toUpperCase()) as never);
    expect(await fake.fire('replying', fake.chat, 'reply')).toBe('REPLY [MODEL]');
    expect(await Risuai.runLLMModel!({ messages: [{ role: 'user', content: 'hi' }], mode: 'otherAx' } as never)).toEqual({ type: 'success', result: 'made' });
    expect(fake.model).toHaveBeenCalledWith('aux', [{ role: 'user', content: 'hi' }]);
    fake.model.mockResolvedValueOnce({ ok: false, reason: 'not-allowed' });
    expect(await Risuai.runLLMModel!({ messages: [], mode: 'model' } as never)).toEqual({ type: 'fail', result: 'not-allowed' });
    expect(fake.model).toHaveBeenLastCalledWith('main', []);
  });

  it('keeps pluginStorage, the local plugin storage and safeLocalStorage apart in the one tool storage', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    await Risuai.pluginStorage!.setItem!('k' as never, 'plugin' as never);
    await (await (Risuai.getLocalPluginStorage!() as Promise<Record<string, (...args: never[]) => Promise<unknown>>>)).setItem!('k' as never, 'local' as never);
    await Risuai.safeLocalStorage!.setItem!('k' as never, 'safe' as never);
    expect(await Risuai.pluginStorage!.getItem!('k' as never)).toBe('plugin');
    expect(await Risuai.safeLocalStorage!.getItem!('k' as never)).toBe('safe');
    expect(await Risuai.pluginStorage!.getItem!('missing' as never)).toBeNull();
    expect(await Risuai.pluginStorage!.keys!()).toEqual(['k']);
    expect(fake.storage.size).toBe(3);
  });
});

// The acceptance plugins (research/risu-plugin-adapter-plan.md §7 phase A) live in the private docs repo, beside this
// checkout; without it this test skips.
const PORTS = new URL('../../docs/research/ports/', import.meta.url);
const port = (path: string) => new URL(path, PORTS);
const available = existsSync(port('risuai-side-phone/Side_Phone.js')) && existsSync(port('risu-fishing/risu_fishing.js'));

// Enough of a page for a plugin's load path: every property, call and construction answers another stand-in.
function standIn(): unknown {
  const target = function () {};
  const proxy: unknown = new Proxy(target, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : proxy),
    set: () => true,
    apply: () => proxy,
    construct: () => proxy as object,
  });
  return proxy;
}

describe.runIf(available)('the acceptance plugins, unmodified', () => {
  const load = async (path: string) => {
    const fake = fakeApi();
    const scope: Record<string, unknown> = {
      document: standIn(), window: standIn(), navigator: standIn(), Image: standIn(), console: { log: () => {}, warn: () => {}, error: () => {} },
      setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, crypto, confirm: () => false, prompt: () => null,
    };
    installRisu(fake.api, scope);
    await runInNewContext(readFileSync(port(path), 'utf8'), scope, { timeout: 5000 });
    return fake;
  };

  it('loads Side Phone and registers its button and its afterRequest replacer, which leaves the reply as it is', async () => {
    const fake = await load('risuai-side-phone/Side_Phone.js');
    await vi.waitFor(() => expect(fake.menus.at(-1)).toEqual([{ id: 'btn-secret-phone', label: '사이드폰' }]));
    expect(await fake.fire('replying', fake.chat, 'the reply')).toBe('the reply');
    expect(fake.missing).toEqual([]);
  });

  it('loads Fishing and registers its buttons, its setting and its hooks', async () => {
    const fake = await load('risu-fishing/risu_fishing.js');
    await vi.waitFor(() => expect(fake.menus.at(-1)).toEqual([{ id: 'risu-fishing-cast', label: '낚시하기' }, { id: 'risu-fishing-dex', label: '낚시 도감' }]));
    expect(await fake.fire('replying', fake.chat, 'the reply')).toBe('the reply');
    await fake.fire('reply', fake.chat, { index: 1, id: 'm1', version: 'v1' });
    await vi.waitFor(() => expect(fake.storage.has('plugin:state_v1')).toBe(true), { timeout: 2000 });
    expect(fake.missing).toEqual([]);
  });
});
