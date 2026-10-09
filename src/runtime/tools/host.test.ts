import { describe, expect, it, vi } from 'vitest';
import { readTool } from '../../engine/import/tool';
import type { Host } from '../../engine/script-api';
import { toolId } from '../../model/tool';
import type { Down, Up } from '../../tool-api/protocol';
import { appendUserMessage, startChat } from '../chat-log';
import { setModuleAlways, setModuleDeleted } from '../modules';
import { ToolLate, ToolStuck } from '../script-binding';
import type { Session } from '../session';
import { answerable, testServer } from '../testing';
import { inProcessTools } from '../testing/tool-transport';
import { ToolHost } from './host';
import { importTool, setToolData, setToolSettings, toolData, toolDataId } from './store';

const server = testServer();
const source = (version = '1', uses = '//@uses model\n') => {
  const result = readTool(new TextEncoder().encode(`//@api 1\n//@name test\n//@author jin\n//@version ${version}\n${uses}//@page Open\n//@menu now Now\n//@setting {"key":"title","type":"text","label":"Title","default":"A"}`));
  if (!result.ok) throw new Error('fixture');
  return result.tool;
};
async function fixture(session: Session, uses?: string) {
  await answerable(session);
  const added = await importTool(session.store, session.files, source('1', uses));
  if (!added.ok) throw new Error(added.error);
  await setModuleAlways(session.store, added.data.id, true);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
  await session.store.projections.evaluate(chat);
  const tool = () => ({ module: added.data.id, tool: session.store.get('tool', toolId(added.data.id))!.value });
  const context = () => session.scripts.pageContext(chat, added.data.id)!;
  return { chat, module: added.data.id, tool, context };
}
const page = (chat: string | null = null) => ({ window: {} as Window, chat, theme: 'dark' as const, close: vi.fn() });

it('handshakes once, memoizes event reads, and sends only changed message tails', () => server.withSession(async (session) => {
  const f = await fixture(session);
  const transport = inProcessTools((api) => {
    api.on('prompt', async (chat) => {
      const messages = await chat.messages();
      await chat.state.get('summary');
      chat.state.set('summary', null);
      return messages.at(-1)!.text;
    });
  });
  const host = new ToolHost(session, () => session.scripts, transport.open);
  const reads = vi.spyOn(session.files, 'read');
  const states = vi.spyOn(session.store.evaluation, 'state');
  try {
    await host.warm(f.chat);
    const run = async () => { const context = f.context(); return host.run(f.chat, [f.tool()], context.scope, { kind: 'prompt' }, context.host); };
    expect(await run()).toMatchObject({ value: 'hello', writes: [['tool:jin/test:summary', ' null']] });
    expect(states).toHaveBeenCalledTimes(1);
    expect(await run()).toMatchObject({ value: 'hello' });
    expect(transport.frames).toHaveLength(1);
    expect(reads).toHaveBeenCalledTimes(1);
    const answers = (transport.frames[0]!.host.sent as Down[]).filter((message) => message.kind === 'answer' && typeof message.value === 'object' && message.value !== null && 'items' in message.value);
    expect(answers.map((message) => (message as Extract<Down, { kind: 'answer' }>).value)).toEqual([{ from: 0, items: [expect.objectContaining({ text: 'hello' })] }, { from: 1, items: [] }]);
  } finally { host.close(); }
}));

it('refuses undeclared spending and forged event contexts, and isolates module storage', () => server.withSession(async (session) => {
  const f = await fixture(session, '');
  let answer: Hazelle.ModelAnswer | null = null;
  const transport = inProcessTools((api) => api.on('prompt', async (chat) => { answer = await chat.model('aux', [{ role: 'user', content: 'hi' }]); return null; }));
  const host = new ToolHost(session, () => session.scripts, transport.open);
  try {
    const context = f.context();
    const model = vi.fn<Host['model']>();
    await host.run(f.chat, [f.tool()], context.scope, { kind: 'prompt' }, { ...context.host, model });
    expect(answer).toEqual({ ok: false, reason: 'not-declared' });
    expect(model).not.toHaveBeenCalled();
    const frame = transport.frames[0]!;
    frame.emit({ kind: 'call', call: 900, event: 9999, method: 'model', args: ['aux', []] });
    await vi.waitFor(() => expect(frame.host.sent).toContainEqual(expect.objectContaining({ kind: 'answer', call: 900, ok: false })));
    const other = await session.store.create('module', { name: 'other', description: '', namespace: null, loreFolders: [], regex: [], triggers: [], toggles: '' });
    if (!other.ok) throw new Error('fixture');
    await setToolData(session.store, other.data.id, 'secret', 'private');
    expect(await frame.api!.storage.get('secret')).toBeUndefined();
  } finally { host.close(); }
}));

it('times out a prompt without applying its late outcome, while model waits still answer pings', () => server.withSession(async (session) => {
  const f = await fixture(session);
  let finish!: (value: Hazelle.ModelAnswer) => void;
  const transport = inProcessTools((api) => api.on('prompt', async (chat) => {
    await chat.model('aux', []);
    chat.state.set('late', true);
    return 'late';
  }));
  const host = new ToolHost(session, () => session.scripts, transport.open);
  const context = f.context();
  const model = vi.fn<Host['model']>(() => new Promise((resolve) => { finish = (value) => resolve(value.ok ? { success: true, result: value.text } : { success: false, result: '', reason: value.reason }); }));
  try {
    await host.warm(f.chat);
    vi.useFakeTimers();
    const abort = new AbortController();
    const running = host.run(f.chat, [f.tool()], context.scope, { kind: 'prompt' }, { ...context.host, model }, abort.signal);
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

it('cuts off a silent frame, restarts on the next event, and stays off after three stalls', () => server.withSession(async (session) => {
  const f = await fixture(session);
  const transport = inProcessTools((api) => api.on('prompt', () => 'ready'));
  const host = new ToolHost(session, () => session.scripts, transport.open);
  try {
    for (let stalled = 0; stalled < 3; stalled++) {
      vi.useFakeTimers();
      await host.warm(f.chat);
      const frame = transport.frames.at(-1)!;
      frame.sandbox.silent = true;
      const context = f.context();
      const running = host.run(f.chat, [f.tool()], context.scope, { kind: 'prompt' }, context.host);
      const refused = expect(running).rejects.toBeInstanceOf(ToolStuck);
      await vi.advanceTimersByTimeAsync(10_001);
      await refused;
      expect(frame.host.closed).toBe(true);
      vi.useRealTimers();
    }
    const context = f.context();
    await expect(host.run(f.chat, [f.tool()], context.scope, { kind: 'prompt' }, context.host)).rejects.toMatchObject({ disabled: true });
    expect(transport.frames).toHaveLength(3);
  } finally { vi.useRealTimers(); host.close(); }
}));

describe('tool storage transport', () => {
  it('merges writes by key, fans out changes from both frames and other devices, and sends new settings', () => server.withSession(async (session) => {
    const f = await fixture(session);
    const changes: string[][] = [];
    const settings: Hazelle.Settings[] = [];
    const transport = inProcessTools((api) => {
      api.storage.onChange((keys) => changes.push(keys));
      if (api.context === 'background') api.on('settings', (values) => { settings.push(values); });
    });
    const host = new ToolHost(session, () => session.scripts, transport.open);
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
      await setToolSettings({ store: session.store, tools: host }, f.module, { title: 'B' });
      await vi.waitFor(() => expect(settings).toEqual([{ title: 'B' }]));
    } finally { vi.useRealTimers(); close(); host.close(); }
  }));

  it('permits at most thirty store writes per minute per tool', () => server.withSession(async (session) => {
    const f = await fixture(session);
    const transport = inProcessTools(() => {});
    const host = new ToolHost(session, () => session.scripts, transport.open);
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

it('restarts changed code, closes on deletion, idles without a page, and retains the file cache', () => server.withSession(async (session) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = new ToolHost(session, () => session.scripts, transport.open);
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

it('ignores malformed outcomes and all messages from a frame after it has closed', () => server.withSession(async (session) => {
  const f = await fixture(session);
  let release!: () => void;
  const transport = inProcessTools((api) => api.on('prompt', () => new Promise<string>((resolve) => { release = () => resolve('late'); })));
  const host = new ToolHost(session, () => session.scripts, transport.open);
  try {
    const context = f.context();
    const running = host.run(f.chat, [f.tool()], context.scope, { kind: 'prompt' }, context.host);
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

it('applies page chat writes through Scripts, distinguishes null and deletion, and keeps the page alive while open', () => server.withSession(async (session) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = new ToolHost(session, () => session.scripts, transport.open);
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

it('allows a standalone page storage but refuses chat calls with no chat capability', () => server.withSession(async (session) => {
  const f = await fixture(session);
  const transport = inProcessTools(() => {});
  const host = new ToolHost(session, () => session.scripts, transport.open);
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
