import { describe, expect, it, vi } from 'vitest';
import { readTool } from '../../engine/import/tool';
import type { Host } from '../../engine/script-api';
import { toolId } from '../../model/tool';
import type { Down, Up } from '../../tool-api/protocol';
import { shown } from '../../model/chat';
import { appendUserMessage, editMessage, startChat } from '../chat-log';
import { setModuleAlways, setModuleDeleted } from '../modules';
import { ToolLate, ToolStuck } from '../script-binding';
import type { Session } from '../session';
import { answerable, testServer } from '../testing';
import { blankCard } from '../../engine/import/card';
import { projectGreetings } from '../greetings';
import { upsertChatLore } from '../lore';
import { inProcessRisu, inProcessTools } from '../testing/tool-transport';
import { ToolHost } from './host';
import type { OpenFrame } from './frame';
import { importTool, setToolData, setToolSettings, toolData, toolDataId } from './store';

const server = testServer();
function withTools(test: (session: Session, connect: (open: OpenFrame) => ToolHost) => Promise<void>) {
  let open!: OpenFrame;
  return server.withSession((session) => test(session, (transport) => {
    open = transport;
    return session.tools as ToolHost;
  }), (session, scripts) => new ToolHost(session, scripts, (page) => open(page)));
}
const source = (version = '1', uses = '//@uses model\n') => {
  const result = readTool(new TextEncoder().encode(`//@api 1\n//@name test\n//@author jin\n//@version ${version}\n${uses}//@page Open\n//@menu now Now\n//@setting {"key":"title","type":"text","label":"Title","default":"A"}`));
  if (!result.ok) throw new Error('fixture');
  return result.tool;
};
async function fixture(session: Session, uses?: string, greeting?: string) {
  await answerable(session);
  const added = await importTool(session.store, session.files, source('1', uses));
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(session.store, added.data.id, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  const card = greeting === undefined ? null : await session.store.create('character', { card: { ...blankCard('Mira'), greetings: [greeting] }, folder: null, loreFolders: [] });
  if (card && !card.ok) throw new Error(card.error);
  await startChat(session.store, chat, { title: null, character: card?.data.id ?? null, models: {} }, card && projectGreetings([greeting!], [crypto.randomUUID()], 0));
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
  await session.store.projections.evaluate(chat);
  const tool = () => ({ module: added.data.id, tool: session.store.get('tool', toolId(added.data.id))!.value });
  const context = () => session.scripts.pageContext(chat, added.data.id)!;
  return { chat, module: added.data.id, tool, context };
}
const page = (chat: string | null = null) => ({ window: {} as Window, chat, theme: 'dark' as const, close: vi.fn() });

it('handshakes once, memoizes event reads, and sends only changed message tails', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools((api) => {
    api.on('prompt', async (chat) => {
      const messages = await chat.messages();
      await chat.state.get('summary');
      chat.state.set('summary', null);
      return messages.at(-1)!.text;
    });
  });
  const host = connect(transport.open);
  const reads = vi.spyOn(session.files, 'read');
  const states = vi.spyOn(session.store.evaluation, 'state');
  try {
    await host.warm(f.chat);
    const run = async () => { const context = f.context(); return host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host); };
    expect(await run()).toMatchObject({ value: 'hello', writes: [['tool:jin/test:summary', ' null']] });
    expect(states).toHaveBeenCalledTimes(1);
    expect(await run()).toMatchObject({ value: 'hello' });
    expect(transport.frames).toHaveLength(1);
    expect(reads).toHaveBeenCalledTimes(1);
    const answers = (transport.frames[0]!.host.sent as Down[]).filter((message) => message.kind === 'answer' && typeof message.value === 'object' && message.value !== null && 'items' in message.value);
    expect(answers.map((message) => (message as Extract<Down, { kind: 'answer' }>).value)).toEqual([{ from: 0, items: [expect.objectContaining({ text: 'hello' })] }, { from: 1, items: [] }]);
  } finally { host.close(); }
}));

it('names each message by its own id and the version shown', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const said = session.store.foldedChat(f.chat).messages[0]!;
  await editMessage(session.store, f.chat, said, 'edited', null);
  await session.store.projections.evaluate(f.chat);
  let read: Hazelle.Message[] = [];
  const transport = inProcessTools((api) => { api.on('prompt', async (chat) => { read = await chat.messages(); return null; }); });
  const host = connect(transport.open);
  try {
    const context = f.context();
    await host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host);
    const edited = shown(session.store.foldedChat(f.chat).messages[0]!).id;
    expect(edited).not.toBe(said.id);
    expect(read).toEqual([expect.objectContaining({ index: 0, id: said.id, version: edited, text: 'edited' })]);
  } finally { host.close(); }
}));

it('reads the greeting apart from the messages, which count from after it', () => withTools(async (session, connect) => {
  const f = await fixture(session, '', 'Welcome, {{user}}.');
  let read: { greeting: string | null; messages: Hazelle.Message[] } | null = null;
  const transport = inProcessTools((api) => { api.on('prompt', async (chat) => { read = { greeting: await chat.greeting(), messages: await chat.messages() }; return null; }); });
  const host = connect(transport.open);
  try {
    const context = f.context();
    await host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host);
    expect(read).toEqual({ greeting: expect.stringMatching(/^Welcome, (?!\{\{)/), messages: [expect.objectContaining({ index: 0, text: 'hello' })] });
  } finally { host.close(); }
}));

it('refuses undeclared spending and forged event contexts, and isolates module storage', () => withTools(async (session, connect) => {
  const f = await fixture(session, '');
  let answer: Hazelle.ModelAnswer | null = null;
  const transport = inProcessTools((api) => api.on('prompt', async (chat) => { answer = await chat.model('aux', [{ role: 'user', content: 'hi' }]); return null; }));
  const host = connect(transport.open);
  try {
    const context = f.context();
    const model = vi.fn<Host['model']>();
    await host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, { ...context.host, model });
    expect(answer).toEqual({ ok: false, reason: 'not-declared' });
    expect(model).not.toHaveBeenCalled();
    const frame = transport.frames[0]!;
    frame.emit({ kind: 'call', call: 900, event: 9999, method: 'model', args: ['aux', []] });
    await vi.waitFor(() => expect(frame.host.sent).toContainEqual(expect.objectContaining({ kind: 'answer', call: 900, ok: false })));
    const other = await session.store.create('module', { name: 'other', description: '', namespace: null, loreFolders: [], regex: [], triggers: [], toggles: [] });
    if (!other.ok) throw new Error('fixture');
    await setToolData(session.store, other.data.id, 'secret', 'private');
    expect(await frame.api!.storage.get('secret')).toBeUndefined();
  } finally { host.close(); }
}));

it('times out a prompt without applying its late outcome, while model waits still answer pings', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  let finish!: (value: Hazelle.ModelAnswer) => void;
  const transport = inProcessTools((api) => api.on('prompt', async (chat) => {
    await chat.model('aux', []);
    chat.state.set('late', true);
    return 'late';
  }));
  const host = connect(transport.open);
  const context = f.context();
  const model = vi.fn<Host['model']>(() => new Promise((resolve) => { finish = (value) => resolve(value.ok ? { success: true, result: value.text } : { success: false, result: '', reason: value.reason }); }));
  try {
    await host.warm(f.chat);
    vi.useFakeTimers();
    const abort = new AbortController();
    const running = host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, { ...context.host, model }, abort.signal);
    const refused = expect(running).rejects.toBeInstanceOf(ToolLate);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport.frames[0]!.host.closed).toBe(false);
    abort.abort(new ToolLate());
    await refused;
    finish({ ok: true, text: 'done' });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.store.children('entry', f.chat).filter(({ value }) => value.type === 'vars')).toEqual([]);
  } finally { vi.useRealTimers(); host.close(); }
}));

it('resets stalls after loading, then disables three consecutive stalled loads and tells once', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools((api) => api.on('prompt', () => 'ready'));
  let silent = true;
  const host = connect((page) => {
    const connection = transport.open(page);
    transport.frames.at(-1)!.sandbox.silent = silent;
    return connection;
  });
  vi.spyOn(session.files, 'read').mockResolvedValue({ ok: true, data: source().bytes });
  const stall = async () => {
    const context = f.context();
    const running = host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host);
    const refused = expect(running).rejects.toBeInstanceOf(ToolStuck);
    await vi.advanceTimersByTimeAsync(8001);
    await refused;
    expect(transport.frames.at(-1)!.host.closed).toBe(true);
  };
  try {
    vi.useFakeTimers();
    await stall();
    await stall();
    silent = false;
    await host.warm(f.chat);
    transport.frames.at(-1)!.sandbox.silent = true;
    await vi.advanceTimersByTimeAsync(10_001);
    expect(transport.frames.at(-1)!.host.closed).toBe(true);
    silent = true;
    await stall();
    await stall();
    await host.warm(f.chat);
    await host.warm(f.chat);
    expect(session.scripts.snapshot().notes.filter((note) => note.kind === 'stuck' && note.disabled)).toHaveLength(1);
    expect(transport.frames).toHaveLength(5);
    const context = f.context();
    await expect(host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host)).rejects.toMatchObject({ disabled: true });
  } finally { vi.useRealTimers(); host.close(); }
}));

it('waits for slow code and page chat reads before starting the load watchdog, and passes a missing persona as null', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  let read!: () => void;
  vi.spyOn(session.files, 'read').mockImplementation(() => new Promise((resolve) => { read = () => resolve({ ok: true, data: source().bytes }); }));
  const retain = session.store.retainChat.bind(session.store);
  let loaded!: () => void;
  vi.spyOn(session.store, 'retainChat').mockImplementation((chat) => {
    const lease = retain(chat);
    return { ...lease, ready: lease.ready.then(() => new Promise<null>((resolve) => { loaded = () => resolve(null); })) };
  });
  const context = f.context();
  vi.spyOn(session.scripts, 'pageContext').mockReturnValue({ ...context, scope: { ...context.scope, persona: null } });
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  try {
    vi.useFakeTimers();
    host.page(f.module, page(f.chat));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.frames[0]!.host.closed).toBe(false);
    read();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.frames[0]!.host.sent).not.toContainEqual(expect.objectContaining({ kind: 'load' }));
    loaded();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.frames[0]!.api!.page!.chat!.persona).toBeNull();
    expect(session.scripts.snapshot().notes).toEqual([]);
  } finally { vi.useRealTimers(); host.close(); }
}));

describe('tool storage transport', () => {
  it('merges writes by key, fans out changes from both frames and other devices, and sends new settings', () => withTools(async (session, connect) => {
    const f = await fixture(session);
    const changes: string[][] = [];
    const settings: Hazelle.Settings[] = [];
    const transport = inProcessTools((api) => {
      api.storage.onChange((keys) => changes.push(keys));
      if (api.context === 'background') api.on('settings', (values) => { settings.push(values); });
    });
    const host = connect(transport.open);
    const close = host.page(f.module, page());
    try {
      await host.warm(f.chat);
      await vi.waitFor(() => expect(transport.frames.every((frame) => frame.api !== null)).toBe(true));
      const [a, b] = transport.frames.map((frame) => frame.api!);
      const writes = vi.spyOn(session.store, 'create');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const first = a!.storage.set('note', 'first');
      const last = b!.storage.set('note', 'last');
      await vi.advanceTimersByTimeAsync(1001);
      vi.useRealTimers();
      await Promise.all([first, last]);
      expect(toolData(session.store, f.module, 'note')).toBe('last');
      expect(writes.mock.calls.filter(([kind]) => kind === 'tooldata')).toHaveLength(1);
      await vi.waitFor(() => expect(changes).toHaveLength(2));
      expect(changes).toEqual([['note'], ['note']]);
      const object = await toolDataId(f.module, 'note');
      await session.store.update('tooldata', object, () => ({ key: 'note', value: 'another device' }));
      await vi.waitFor(() => expect(changes).toHaveLength(4));
      expect(await a!.storage.get('note')).toBe('another device');
      await setToolSettings(session, f.module, { title: 'B' });
      await vi.waitFor(() => expect(settings).toEqual([{ title: 'B' }]));
    } finally { vi.useRealTimers(); close(); host.close(); }
  }));

  it('permits at most thirty store writes per minute per tool', () => withTools(async (session, connect) => {
    const f = await fixture(session);
    const transport = inProcessTools(() => {});
    const host = connect(transport.open);
    try {
      await host.warm(f.chat);
      const api = transport.frames[0]!.api!;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const writes = Array.from({ length: 31 }, (_, index) => api.storage.set(String(index), index));
      const settled = Promise.allSettled(writes);
      await vi.advanceTimersByTimeAsync(1001);
      vi.useRealTimers();
      const results = await settled;
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(30);
      expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(session.store.children('tooldata', f.module)).toHaveLength(30);
    } finally { vi.useRealTimers(); host.close(); }
  }));
});

it('restarts changed code, closes on deletion, idles without a page, and retains the file cache', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const read = vi.spyOn(session.files, 'read');
  try {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await host.warm(f.chat);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(transport.frames[0]!.host.closed).toBe(true);
    vi.useRealTimers();
    await host.warm(f.chat);
    expect(read).toHaveBeenCalledTimes(1);
    await importTool(session.store, session.files, source('2'));
    await vi.waitFor(() => expect(transport.frames[1]!.host.closed).toBe(true));
    await host.warm(f.chat);
    expect(read).toHaveBeenCalledTimes(2);
    await setModuleDeleted(session.store, f.module, Date.now());
    await vi.waitFor(() => expect(transport.frames[2]!.host.closed).toBe(true));
    expect(host.menus(f.chat)).toEqual([]);
  } finally { vi.useRealTimers(); host.close(); }
}));

it('ignores malformed outcomes and all messages from a frame after it has closed', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  let release!: () => void;
  const transport = inProcessTools((api) => api.on('prompt', () => new Promise<string>((resolve) => { release = () => resolve('late'); })));
  const host = connect(transport.open);
  try {
    const context = f.context();
    const running = host.run(f.chat, f.tool(), context.scope, { kind: 'prompt', turn: { memory: false } }, context.host);
    const refused = expect(running).rejects.toThrow('Invalid tool outcome');
    await vi.waitFor(() => expect(release).toBeDefined());
    const frame = transport.frames[0]!;
    const event = (frame.host.sent as Down[]).find((message) => message.kind === 'event')!;
    frame.emit({ kind: 'done', id: event.id, outcome: { writes: [['key', NaN]], edits: [], added: [] } } as unknown as Up);
    await refused;
    const receive = frame.host.onmessage!;
    host.close();
    receive(new MessageEvent('message', { data: { kind: 'call', call: 90, method: 'storage.set', args: ['after-close', true] } }));
    await Promise.resolve();
    expect(toolData(session.store, f.module, 'after-close')).toBeUndefined();
  } finally { release?.(); host.close(); }
}));

it('notifies a running tool after pulling a data change written on another device', async () => {
  const account = await server.account();
  const added = await importTool(account.store, account.files, source());
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(account.store, added.data.id, true);
  const chat = crypto.randomUUID();
  await server.hold(account.store, chat);
  await startChat(account.store, chat, { title: null, character: null, models: {} }, null);
  const changes = vi.fn();
  const transport = inProcessTools((api) => { api.storage.onChange(changes); });
  const host = new ToolHost(account, () => ({ report: () => {}, pageContext: () => null, pageWrite: async () => {} }), transport.open);
  try {
    await host.warm(chat);
    const peer = await account.open();
    await peer.pull();
    expect((await setToolData(peer, added.data.id, 'remote', { note: 'from another device' })).ok).toBe(true);
    expect(await account.store.pull()).toBeNull();
    await vi.waitFor(() => expect(changes).toHaveBeenCalledWith(['remote']));
    expect(await transport.frames[0]!.api!.storage.get('remote')).toEqual({ note: 'from another device' });
  } finally { host.close(); }
});

it('applies page chat writes through Scripts, distinguishes null and deletion, and keeps the page alive while open', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const descriptor = page(f.chat);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const close = host.page(f.module, descriptor);
  try {
    await vi.waitFor(() => expect(transport.frames[0]!.api).not.toBeNull());
    const chat = transport.frames[0]!.api!.page!.chat!;
    chat.state.set('nullable', null);
    expect(await chat.state.get('nullable')).toBeNull();
    await vi.waitFor(() => expect(session.store.children('entry', f.chat).filter(({ value }) => value.type === 'vars')).toMatchObject([{ value: { stays: true, set: [['tool:jin/test:nullable', ' null']] } }]));
    chat.state.delete('nullable');
    expect(await chat.state.get('nullable')).toBeUndefined();
    await vi.waitFor(() => expect(session.store.children('entry', f.chat).filter(({ value }) => value.type === 'vars')).toHaveLength(2));
    expect(await chat.state.get('nullable')).toBeUndefined();
    await host.warm(f.chat);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(transport.frames[0]!.host.closed).toBe(false);
    vi.useRealTimers();
    expect(descriptor.close).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); close(); host.close(); }
}));

it('allows a standalone page storage but refuses chat calls with no chat capability', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const close = host.page(f.module, page());
  try {
    await vi.waitFor(() => expect(transport.frames[0]!.api).not.toBeNull());
    const frame = transport.frames[0]!;
    expect(frame.api!.page!.chat).toBeNull();
    frame.emit({ kind: 'call', call: 77, method: 'model', args: ['aux', []] });
    await vi.waitFor(() => expect(frame.host.sent).toContainEqual({ kind: 'answer', call: 77, ok: false, value: 'no-chat' }));
    expect(session.scripts.snapshot().questions).toEqual([]);
  } finally { close(); host.close(); }
}));

it('shares the write budget with forged page outcomes and bounds tool notices across ids', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const apply = vi.spyOn(session.scripts, 'pageWrite').mockResolvedValue();
  const close = host.page(f.module, page(f.chat));
  try {
    await vi.waitFor(() => expect(transport.frames[0]!.api).not.toBeNull());
    const frame = transport.frames[0]!;
    await expect(frame.api!.storage.set('x'.repeat(257), null)).rejects.toThrow('key-too-long');
    for (let i = 0; i < 1000; i++) frame.emit({ kind: 'done', id: 0, outcome: { writes: [], edits: [], added: [{ role: 'char', text: 'flood' }], data: [], badges: [] } });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(30));
    expect(frame.host.sent).toContainEqual(expect.objectContaining({ kind: 'answer', call: 0, ok: false, value: 'too-many-writes' }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const write = expect(frame.api!.storage.set('over-budget', true)).rejects.toThrow('too-many-writes');
    await vi.advanceTimersByTimeAsync(1001);
    await write;
    vi.useRealTimers();
    for (let i = 0; i < 10; i++) frame.emit({ kind: 'failed', id: 0, message: 'same failure' });
    for (let i = 0; i < 10; i++) frame.emit({ kind: 'call', call: 100 + i, method: 'say', args: ['normal', `notice ${i}`] });
    await vi.waitFor(() => expect(session.scripts.snapshot().notes).toHaveLength(3));
    expect(session.scripts.snapshot().notes.filter((note) => note.kind === 'failed')).toHaveLength(1);
  } finally { vi.useRealTimers(); close(); host.close(); }
}));

it('runs a frame tool as one frame: its registered items, a press from the chat, a remounted slot, its page and the chat it reads', () => withTools(async (session, connect) => {
  await answerable(session);
  const parsed = source('1', '');
  const added = await importTool(session.store, session.files, { ...parsed, manifest: { ...parsed.manifest, page: null, menu: [], risu: { verdict: 'all', missing: [], hosts: [] } } });
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(session.store, added.data.id, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const module = added.data.id;
  const pressed = vi.fn();
  const opens = vi.fn();
  const transport = inProcessRisu((scope) => {
    const risu = scope.Risuai as Record<string, (...args: unknown[]) => Promise<unknown>>;
    void risu.registerButton!({ name: 'Cast', id: 'cast' }, async () => { pressed(await risu.getCurrentChatIndex!()); await risu.showContainer!('fullscreen'); });
    void risu.registerSetting!('Open', () => { opens(); return risu.showContainer!('fullscreen'); });
  });
  const host = connect(transport.open);
  try {
    await host.warm(chat);
    const { items } = host;
    await vi.waitFor(() => expect(items(module)).toEqual([{ id: 'cast', label: 'Cast' }]));
    expect(transport.frames.map((frame) => frame.api?.context)).toEqual(['frame']);
    await session.scripts.menu(chat, module, 'cast');
    await vi.waitFor(() => expect(host.frames().get(module)).toEqual({ menu: [{ id: 'cast', label: 'Cast' }], chat, asking: true }));
    expect(pressed.mock.calls[0]![0]).toEqual(expect.any(Number));
    expect(pressed.mock.calls[0]![0]).not.toBe(-1);
    const shownIn = { chat, place: vi.fn(), close: vi.fn() };
    const detach = host.attach(module, shownIn);
    await vi.waitFor(() => expect(shownIn.place).toHaveBeenCalledTimes(1));
    expect(host.frames().get(module)?.asking).toBe(false);
    detach();
    const remounted = { chat, place: vi.fn(), close: vi.fn() };
    const detachRemounted = host.attach(module, remounted);
    await vi.waitFor(() => expect(remounted.place).toHaveBeenCalledTimes(1));
    expect(opens).not.toHaveBeenCalled();
    detachRemounted();
    await vi.waitFor(() => expect(host.frames().get(module)?.asking).toBe(false));
    const opened = { chat: null, place: vi.fn(), close: vi.fn() };
    host.attach(module, opened);
    await vi.waitFor(() => expect(opened.place).toHaveBeenCalledTimes(1));
    expect(opens).toHaveBeenCalledTimes(1);
    expect(transport.frames).toHaveLength(1);
  } finally { host.close(); }
}));

it('writes a tool\'s own settings field and refuses a value the field cannot hold', () => withTools(async (session, connect) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  try {
    await host.warm(f.chat);
    const api = transport.frames[0]!.api!;
    await api.setSetting('title', 'B');
    expect(session.store.get('tool', toolId(f.module))!.value.settings).toEqual({ title: 'B' });
    await expect(api.setSetting('title', 3)).rejects.toThrow('Invalid tool call');
    await expect(api.setSetting('missing', 'x')).rejects.toThrow('Invalid tool call');
  } finally { host.close(); }
}));

it('reads the chat\'s lorebook by owner, how the chat is set up, and the account\'s personas and characters', () => withTools(async (session, connect) => {
  const f = await fixture(session, undefined, 'Hello.');
  const character = session.store.get('chat', f.chat)!.value.character!;
  await upsertChatLore(session.store, f.chat, { name: 'Gate', keys: ['gate'], secondaryKeys: [], content: 'The gate is shut.', enabled: true, constant: false, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 0, priority: null, position: null });
  const transport = inProcessTools(() => {});
  const host = connect(transport.open);
  const close = host.page(f.module, page(f.chat));
  try {
    await vi.waitFor(() => expect(transport.frames[0]?.api).not.toBeNull());
    const api = transport.frames[0]!.api!;
    expect(await api.page!.chat!.lorebook()).toEqual([{ name: 'Gate', keys: ['gate'], text: 'The gate is shut.', always: false, on: true, owner: { kind: 'chat', id: f.chat } }]);
    const account = await api.account();
    expect(account.characters).toEqual([{ id: character, name: 'Mira' }]);
    const setup = await api.page!.chat!.setup();
    expect(setup).toEqual({ persona: account.personas.find(({ current }) => current)?.id ?? null, limits: { context: null, reply: null }, modules: [{ id: f.module, name: 'test' }] });
  } finally { close(); host.close(); }
}));

it('answers a frame tool\'s unload callbacks while its port stays open, then closes it', () => withTools(async (session, connect) => {
  await answerable(session);
  const parsed = source('1', '');
  const added = await importTool(session.store, session.files, { ...parsed, manifest: { ...parsed.manifest, page: null, menu: [], risu: { verdict: 'all', missing: [], hosts: [] } } });
  if (!added.ok) throw new Error(added.error);
  const module = added.data.id;
  await setModuleAlways(session.store, module, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const transport = inProcessRisu((scope) => {
    const risu = scope.Risuai as { onUnload(callback: () => unknown): Promise<void>; pluginStorage: { setItem(key: string, value: string): Promise<void> } };
    void risu.onUnload(() => risu.pluginStorage.setItem('last', 'saved'));
  });
  const host = connect(transport.open);
  try {
    await host.warm(chat);
    await vi.waitFor(() => expect(host.hears(module, 'menu')).toBe(true));
    await setModuleAlways(session.store, module, false);
    await vi.waitFor(() => expect(toolData(session.store, module, 'plugin:last')).toBe('saved'), { timeout: 3000 });
    await vi.waitFor(() => expect(transport.frames[0]!.host.closed).toBe(true));
  } finally { host.close(); }
}));
