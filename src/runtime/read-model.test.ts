import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../engine/import/types';
import * as chatModel from '../model/chat';
import type { Chat } from '../model/chat';
import { randomBytes } from '../vault/aead';
import * as sealedObjects from '../vault/objects';
import { exportBackup, readBackup } from './testing/backup';
import { removeChat, restoreChat } from './chat-log';
import { Files } from './files';
import { backfillSummaries, saveSummaries, summaryId, summaryStale } from './summary';
import type { api, ApiResult } from './api';
import { EvaluationFailed } from './evaluation';
import { ReadModels } from './read-model';
import { planRemoval } from './removal';
import { openSession } from './session';
import { Streams } from './streams';
import { ObjectStore, type StoreChange } from './store';
import type { Turn } from './talk';

type Wire = StoreChange & { rev: number; body: string | null };
async function account() {
  const changes = new Map<string, Wire>();
  let rev = 0;
  const paths: string[] = [];
  const request: typeof api = async <T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> => {
    paths.push(path);
    if (method === 'GET') {
      const params = new URL(path, 'https://test/').searchParams;
      const since = Number(params.get('since'));
      const excluded = (params.get('exclude') ?? '').split(',');
      const parent = params.get('parent');
      const bootstrap = params.get('bootstrap') === '1';
      const until = Number(params.get('until') ?? rev);
      const candidates = [...changes.values()].filter((change) => change.rev > since
        && (parent === null || change.parent === parent)
        && (!bootstrap || (change.rev <= until && !excluded.includes(change.kind))))
        .sort((a, b) => a.rev - b.rev);
      const page = candidates.slice(0, 2).map(({ body, ...row }) => body !== null && (excluded.includes(row.kind) || params.has('metadata')) ? { ...row, omitted: true } : { ...row, body });
      const cursor = page.at(-1)?.rev ?? since;
      return { ok: true, data: { timeline: 't', changes: page, cursor, more: candidates.length > page.length, ...(bootstrap && { until }), limits: { items: 100, bytes: 1_000_000, body: 100_000 } } as T };
    }
    const writes = (body as { writes: (Omit<Wire, 'rev'> & { baseRev: number | null })[] }).writes;
    if (writes.some((write) => (changes.get(write.id)?.rev ?? null) !== write.baseRev)) return { ok: false, error: 'conflict' };
    const revs = writes.map(({ id, kind, parent, body }) => {
      changes.set(id, { id, kind, parent, body, rev: ++rev });
      return rev;
    });
    return { ok: true, data: { revs, timeline: 't' } as T };
  };
  const key = randomBytes(32);
  const open = async () => {
    const store = await ObjectStore.open('account', key, request);
    await store.pull();
    return store;
  };
  const seed = async (id: string, kind: string, parent: string | null, value: unknown) => {
    const body = await sealedObjects.sealObject(await sealedObjects.objectKey(key), 'account', { id, kind, parent }, value);
    changes.set(id, { id, kind, parent, body, rev: ++rev });
  };
  return { store: await open(), open, seed, paths, request, key };
}

async function hold(store: ObjectStore, ...ids: string[]) {
  const leases = ids.map((id) => store.retainChat(id));
  for (const lease of leases) expect(await lease.ready).toBeNull();
  return () => leases.forEach((lease) => lease.release());
}

const chat: Chat = { title: null, character: null, models: {} };
const message = (text: string) => ({ type: 'message' as const, role: 'user' as const, text, at: 0, receipt: null });
const card = (name: string): Card => ({ name, nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: '', utility: false, bias: [], regex: [], triggers: [], loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null } });
const liveTalk = () => {
  let turn: Turn | null = null;
  const listeners = new Set<() => void>();
  return {
    snapshot: () => turn,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (next: Turn | null) => { turn = next; for (const listener of listeners) listener(); },
  };
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('selective account reads', () => {
  it('opens home and every list from summaries without decrypting, folding or displaying entries', async () => {
    const { store, request, key } = await account();
    await store.batch([
      { type: 'create', kind: 'chat', id: 'a', parent: null, value: chat },
      { type: 'create', kind: 'entry', id: 'a1', parent: 'a', value: message('hello') },
    ]);
    const decrypt = vi.spyOn(sealedObjects, 'openObject');
    const folded = vi.spyOn(chatModel, 'fold');
    const displayed = vi.spyOn(store.evaluation, 'display');
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const answer = await request(init.method as 'GET' | 'POST', url.slice('/api/'.length), init.body ? JSON.parse(init.body as string) : undefined);
      return Response.json(answer.ok ? answer.data : answer, { status: answer.ok ? 200 : 500 });
    });
    const opened = await openSession('account', key, 'Jin', new AbortController().signal);
    if (!opened.ok) throw new Error(opened.error);
    const { read } = opened.data;
    expect(read.chats.snapshot()).toMatchObject([{ title: 'hello', preview: 'hello', count: 1 }]);
    expect(read.library.snapshot().none.chats).toEqual(read.chats.snapshot());
    expect(read.summary('a').snapshot()?.title).toBe('hello');
    expect(read.chat('a').snapshot()).toBeNull();
    expect(decrypt.mock.calls.some(([, , address]) => address.kind === 'entry' || address.kind === 'memory')).toBe(false);
    expect(folded).not.toHaveBeenCalled();
    expect(displayed).not.toHaveBeenCalled();
    opened.data.close();
  });

  it('coalesces a chat scope load, refuses unloaded reads and releases entries and display after its last holder', async () => {
    const { seed, open, paths } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('held'));
    const store = await open();
    const read = new ReadModels(store);
    expect(() => store.children('entry', 'a')).toThrow('not loaded');
    expect(() => store.get('entry', 'a1')).toThrow('not loaded');
    const first = store.retainChat('a');
    const second = store.retainChat('a');
    expect(store.scopeState('a')).toBe('loading');
    expect(await first.ready).toBeNull();
    expect(await second.ready).toBeNull();
    expect(paths.filter((path) => path.includes('parent=a'))).toHaveLength(1);
    expect(read.chat('a').snapshot()?.messages).toHaveLength(1);
    first.release();
    expect(store.scopeState('a')).toBe('loaded');
    second.release();
    expect(store.scopeState('a')).toBe('unloaded');
    expect(read.chat('a').snapshot()).toBeNull();
    expect(store.projection('a')).toBeNull();
    expect(() => store.get('entry', 'a1')).toThrow('not loaded');
    expect(read.chats.snapshot()[0]?.preview).toBe('held');
    read.close();
  });

  it('detects entry-head and display-dependency staleness and rebuilds the bounded encrypted projection on load', async () => {
    const { store, seed, open } = await account();
    await seed('persona', 'persona', null, { name: 'Jin', description: '', picture: null });
    await seed('ca', 'character', null, { card: card('Luna'), folder: null, loreFolders: [] });
    for (let index = 0; index < 10; index++) await seed(`asset${index}`, 'asset', 'ca', { name: `asset${index}`, type: 'image/png', size: 1, file: { id: '0'.repeat(64), key: 'key' } });
    await store.pull();
    await store.batch([
      { type: 'create', kind: 'chat', id: 'a', parent: null, value: { ...chat, persona: 'persona', character: 'ca' } },
      { type: 'create', kind: 'entry', id: 'a1', parent: 'a', value: message('{{user}}, hello') },
    ]);
    const device = await open();
    const original = device.get('summary', summaryId('a'))!.value;
    expect(original).toMatchObject({ title: 'Jin, hello', count: 1, version: 1 });
    expect(original.dependencies.filter((read) => read.kind === 'asset')).toEqual([{ kind: 'asset', parent: 'ca', rev: expect.any(Number) }]);
    expect(summaryStale(device, 'a', original)).toBe(false);
    expect(summaryStale(device, 'a', { ...original, version: 0 })).toBe(true);
    await seed('persona', 'persona', null, { name: 'Mina', description: '', picture: null });
    await seed('a2', 'entry', 'a', message('x'.repeat(500)));
    await device.pull();
    expect(summaryStale(device, 'a', original)).toBe(true);
    expect(device.scopeState('a')).toBe('unloaded');
    const lease = device.retainChat('a');
    expect(await lease.ready).toBeNull();
    const rebuilt = device.get('summary', summaryId('a'))!.value;
    expect(rebuilt).toMatchObject({ title: 'Mina, hello', count: 2, preview: 'x'.repeat(256) });
    expect(summaryStale(device, 'a', rebuilt)).toBe(false);
    lease.release();
  });

  it('keeps a failed scope distinct from an empty chat and permits an explicit retry', async () => {
    const { seed, request, key } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('not lost'));
    let offline = true;
    const flaky: typeof api = (method, path, body, signal) => offline && path.includes('parent=a')
      ? Promise.resolve({ ok: false, error: 'offline' }) : request(method, path, body, signal);
    const store = await ObjectStore.open('account', key, flaky);
    await store.pull();
    const first = store.retainChat('a');
    expect(await first.ready).toEqual({ ok: false, error: 'offline' });
    expect(store.scopeState('a')).toBe('failed');
    expect(() => store.children('entry', 'a')).toThrow('not loaded');
    offline = false;
    const retry = store.retainChat('a');
    expect(await retry.ready).toBeNull();
    expect(store.projection('a')?.model.messages).toHaveLength(1);
    first.release();
    retry.release();
  });

  it('aborts an abandoned scope load instead of retaining its decrypted messages', async () => {
    const { seed, request, key } = await account();
    await seed('a', 'chat', null, chat);
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    const delayed: typeof api = (method, path, body, signal) => {
      if (!path.includes('parent=a')) return request(method, path, body, signal);
      started();
      return new Promise((resolve) => signal!.addEventListener('abort', () => resolve({ ok: false, error: 'stopped' }), { once: true }));
    };
    const store = await ObjectStore.open('account', key, delayed);
    await store.pull();
    const lease = store.retainChat('a');
    await waiting;
    lease.release();
    expect(await lease.ready).toEqual({ ok: false, error: 'stopped' });
    expect(store.scopeState('a')).toBe('unloaded');
    expect(store.projection('a')).toBeNull();
  });

  it('refreshes held memory on a conflict before reapplying the edit', async () => {
    const { store, open } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('memory', { records: [], state: [], threads: [] }, { id: 'memory', parent: 'a' });
    const phone = await open();
    const release = await hold(store, 'a');
    const releasePhone = await hold(phone, 'a');
    await store.update('memory', 'memory', (memory) => ({ ...memory, threads: [{ id: 'first', text: 'first', opened: null }] }));
    const saved = await phone.update('memory', 'memory', (memory) => ({ ...memory, threads: [...memory.threads, { id: 'second', text: 'second', opened: null }] }));
    expect(saved.ok && saved.data.value.threads.map(({ id }) => id)).toEqual(['first', 'second']);
    release();
    releasePhone();
  });

  it('checks a detached result inside its loaded scope, retrying a failed read without resuming an already saved reply', async () => {
    const { seed, request, key } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('saved'));
    await seed('stream', 'stream', 'a', { key: {}, call: { connection: 'c', source: 'c', model: 'm', modelName: 'm' }, at: 0, result: 'a1', for: { kind: 'reply', message: null, replaces: null, continues: null } });
    let offline = true;
    const flaky: typeof api = (method, path, body, signal) => offline && path.includes('parent=a')
      ? Promise.resolve({ ok: false, error: 'offline' }) : request(method, path, body, signal);
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    const store = await ObjectStore.open('account', key, flaky);
    await store.pull();
    const take = vi.fn();
    const streams = new Streams(store, new Set(), take);
    try {
      streams.pickUp();
      await vi.waitFor(() => expect(store.scopeState('a')).toBe('unloaded'));
      expect(store.get('stream', 'stream')).not.toBeNull();
      offline = false;
      streams.pickUp();
      await vi.waitFor(() => expect(store.get('stream', 'stream')).toBeNull());
      expect(take).not.toHaveBeenCalled();
      expect(store.scopeState('a')).toBe('unloaded');
    } finally { streams.close(); }
  });

  it('ends a summary write waiting on the server once its chat is let go, though a catch-up ran during it', async () => {
    const { request, key, seed } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('one'));
    let blocked = false;
    let waiting = false;
    const store = await ObjectStore.open('account', key, async (method, path, body, signal) => {
      if (!blocked || method !== 'POST') return request(method, path, body, signal);
      waiting = true;
      return new Promise((resolve) => signal!.addEventListener('abort', () => resolve({ ok: false, error: 'stopped' }), { once: true }));
    });
    await store.pull();
    const lease = store.retainChat('a');
    expect(await lease.ready).toBeNull();
    await seed('a2', 'entry', 'a', message('two'));
    expect(await store.refreshChat('a')).toBeNull();
    blocked = true;
    const saving = store.saveSummary('a');
    await vi.waitFor(() => expect(waiting).toBe(true));
    await seed('a3', 'entry', 'a', message('three'));
    expect(await store.refreshChat('a')).toBeNull();
    lease.release();
    expect(await saving).toEqual({ ok: false, error: 'stopped' });
    store.close();
  });

  it('stops a summary pass whose write lands as it is cancelled, holding the chat until the write ends', async () => {
    const { request, key, seed } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('one'));
    let land: (() => void) | null = null;
    const store = await ObjectStore.open('account', key, async (method, path, body, signal) => {
      if (method !== 'POST') return request(method, path, body, signal);
      return new Promise((resolve) => {
        land = () => resolve(request(method, path, body, signal));
        signal!.addEventListener('abort', land, { once: true });
      });
    });
    await store.pull();
    const stop = new AbortController();
    const saving = saveSummaries(store, ['a'], stop.signal);
    await vi.waitFor(() => expect(land).not.toBeNull());
    stop.abort();
    expect(store.scopeState('a')).toBe('loaded');
    land!();
    expect(await saving).toEqual({ ok: false, error: 'stopped' });
    expect(store.scopeState('a')).toBe('unloaded');
    store.close();
  });

  it('backfills missing summaries one chat at a time and resumes without revisiting completed chats', async () => {
    const { seed, open, paths } = await account();
    for (const id of ['a', 'b']) {
      await seed(id, 'chat', null, chat);
      await seed(`${id}1`, 'entry', id, message(id));
    }
    const store = await open();
    const read = new ReadModels(store);
    expect(read.chats.snapshot().every((chat) => chat.count === null)).toBe(true);
    const stop = new AbortController();
    const leave = store.subscribe((changes) => {
      if (changes.some((change) => change.kind === 'summary')) stop.abort();
    });
    await backfillSummaries(store, stop.signal);
    leave();
    expect(store.list('summary')).toHaveLength(1);
    expect(store.scopeState('a')).toBe('unloaded');
    const before = paths.length;
    await backfillSummaries(store, new AbortController().signal);
    expect(paths.slice(before).some((path) => path.includes('parent=a'))).toBe(false);
    expect(store.list('summary')).toHaveLength(2);
    expect(store.scopeState('b')).toBe('unloaded');
    read.close();
  });

  it('exports every entry through an explicit account walk without filling any chat scope', async () => {
    const { seed, open, request } = await account();
    for (const id of ['a', 'b']) {
      await seed(id, 'chat', null, chat);
      for (let index = 0; index < 3; index++) await seed(`${id}${index}`, 'entry', id, message(`${id}${index}`));
    }
    const store = await open();
    const parts: BlobPart[] = [];
    const exported = await exportBackup(store, new Files(request, store), {
      write: async (bytes) => { parts.push(bytes); }, close: async () => {}, abort: async () => { parts.length = 0; },
    });
    if (!exported.ok) throw new Error(exported.error);
    const backup = await readBackup(new Blob(parts));
    if (!backup.ok) throw new Error(backup.error);
    expect(backup.backup.objects.filter((object) => object.kind === 'entry')).toHaveLength(6);
    expect(store.scopeState('a')).toBe('unloaded');
    expect(store.scopeState('b')).toBe('unloaded');
  });

  it('plans complete owned removals from metadata without loading a closed chat', async () => {
    const { seed, open } = await account();
    await seed('ca', 'character', null, { card: card('Luna'), folder: null, loreFolders: [] });
    await seed('a', 'chat', null, { ...chat, character: 'ca' });
    await seed('a1', 'entry', 'a', message('one'));
    await seed('a2', 'entry', 'a', message('two'));
    await seed('memory', 'memory', 'a', { records: [], state: [], threads: [] });
    const store = await open();
    const decrypt = vi.spyOn(sealedObjects, 'openObject');
    const plan = await store.pinned((pin) => planRemoval(store, { kind: 'character', id: 'ca' }, pin));
    expect(plan.ok && plan.data.map((round) => round.map(({ id }) => id))).toEqual([['a1', 'a2', 'memory'], ['a'], ['ca']]);
    expect(decrypt).not.toHaveBeenCalled();
    expect(store.scopeState('a')).toBe('unloaded');
  });

  it('removes a closed chat and brings it back without loading messages', async () => {
    const { seed, open } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('kept for undo'));
    const store = await open();
    const decrypt = vi.spyOn(sealedObjects, 'openObject');
    const removed = await removeChat(store, 'a');
    if (!removed.ok) throw new Error(removed.error);
    expect(decrypt).not.toHaveBeenCalled();
    expect(store.scopeState('a')).toBe('unloaded');
    expect((await restoreChat(store, 'a')).ok).toBe(true);
    expect(decrypt).not.toHaveBeenCalled();
    expect(store.scopeState('a')).toBe('unloaded');
  });

  it('leaves a deleted chat’s call untaken, and takes it once 되돌리기 brings the chat back', async () => {
    const { seed, open } = await account();
    await seed('a', 'chat', null, chat);
    await seed('stream', 'stream', 'a', { key: {}, call: { connection: 'c', source: 'c', model: 'm', modelName: 'm' }, at: 0, result: 'reply', for: { kind: 'reply', message: null, replaces: null, continues: null } });
    const store = await open();
    await removeChat(store, 'a');
    const take = vi.fn();
    const opened = vi.spyOn(store, 'withChat');
    const streams = new Streams(store, new Set(), take);
    try {
      streams.pickUp();
      expect(opened).not.toHaveBeenCalled();
      await restoreChat(store, 'a');
      streams.pickUp();
      await vi.waitFor(() => expect(take).toHaveBeenCalledOnce());
    } finally { streams.close(); }
  });
});

describe('per-chat read models', () => {
  it('A: a translation or new entry in A never folds or displays B, including pulled writes', async () => {
    const { store, open } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('A'), { id: 'a1', parent: 'a' });
    await store.create('entry', message('B'), { id: 'b1', parent: 'b' });
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    const b = read.chat('b').snapshot();
    const folders = read.library.snapshot();
    const connectionSnapshot = read.kind('connection').snapshot();
    const personaSnapshot = read.kind('persona').snapshot();
    const bChanged = vi.fn();
    read.chat('b').subscribe(bChanged);
    const folded = vi.spyOn(chatModel, 'fold');
    const displayed = vi.spyOn(store.evaluation, 'display');
    await store.create('entry', { type: 'translation', version: 'a1', text: '번역', receipt: null, at: 1 }, { parent: 'a' });
    const phone = await open();
    await phone.create('entry', message('later'), { parent: 'a' });
    await store.pull();
    expect(folded.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(folded.mock.calls.every(([entries]) => entries.every((entry) => entry.parent === 'a'))).toBe(true);
    expect(displayed.mock.calls.every(([lane]) => lane.endsWith(':a'))).toBe(true);
    expect(read.chat('b').snapshot()).toBe(b);
    expect(bChanged).not.toHaveBeenCalled();
    expect(read.library.snapshot()).not.toBe(folders);
    expect(read.kind('connection').snapshot()).toBe(connectionSnapshot);
    expect(read.kind('persona').snapshot()).toBe(personaSnapshot);
    expect(read.chat('a').snapshot()?.title).toBe('번역');
    expect(read.chat('a').snapshot()?.preview).toBe('later');
    read.close();
  });

  it('B: character, prompt and persona changes redisplay only their readers and replace recorded dependencies', async () => {
    const { store } = await account();
    for (const id of ['ca', 'cb']) await store.create('character', { card: card(id), folder: null, loreFolders: [] }, { id });
    for (const id of ['pa', 'pb']) await store.create('prompt', { name: id, blocks: [], toggles: [], authorNote: '', models: {} }, { id });
    for (const id of ['ua', 'ub']) await store.create('persona', { name: id, description: '', picture: null }, { id });
    await store.create('chat', { ...chat, character: 'ca', prompt: 'pa', persona: 'ua' }, { id: 'a' });
    await store.create('chat', { ...chat, character: 'cb', prompt: 'pb', persona: 'ub' }, { id: 'b' });
    for (const id of ['a', 'b']) await store.create('entry', message('{{char}} / {{user}} / {{authornote}}'), { parent: id });
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    const b = read.chat('b').snapshot();
    const folded = vi.spyOn(chatModel, 'fold');
    const displayed = vi.spyOn(store.evaluation, 'display');
    await store.update('character', 'ca', (current) => ({ ...current, card: { ...current.card, name: 'Luna' } }));
    await store.update('prompt', 'pa', (current) => ({ ...current, authorNote: 'night' }));
    await store.update('persona', 'ua', (current) => ({ ...current, name: 'Mina' }));
    expect(displayed.mock.calls.map(([lane]) => lane.split(':').at(-1))).toEqual(['a', 'a', 'a']);
    expect(folded).not.toHaveBeenCalled();
    expect(read.chat('b').snapshot()).toBe(b);
    expect(read.chat('a').snapshot()?.display.texts).toEqual(['Luna / Mina / night']);
    await store.update('chat', 'a', (current) => ({ ...current, persona: 'missing' }));
    displayed.mockClear();
    await store.update('persona', 'ua', (current) => ({ ...current, name: 'unused' }));
    expect(displayed).not.toHaveBeenCalled();
    await store.create('persona', { name: 'arrived', description: '', picture: null }, { id: 'missing' });
    expect(displayed.mock.calls.map(([lane]) => lane.split(':').at(-1))).toEqual(['a']);
    expect(read.chat('a').snapshot()?.preview).toBe('Luna / arrived / night');
    read.close();
  });

  it('answers a write the server took as done when its chat cannot be evaluated after it, and shows that on the chat', async () => {
    const { store } = await account();
    await store.batch([
      { type: 'create', kind: 'chat', id: 'a', parent: null, value: chat },
      { type: 'create', kind: 'entry', id: 'a1', parent: 'a', value: message('hello') },
    ]);
    const release = await hold(store, 'a');
    vi.spyOn(store.evaluation, 'display').mockRejectedValueOnce(new EvaluationFailed('crashed'));
    expect(await store.update('chat', 'a', (value) => ({ ...value, note: 'kept' }))).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(store.scopeState('a')).toBe('failed'));
    expect(store.scopeError('a')).toEqual({ ok: false, error: 'evaluation-unavailable' });
    release();
  });

  it('never publishes an evaluated projection whose dependencies changed while the worker was busy', async () => {
    const { store } = await account();
    await store.create('persona', { name: 'first', description: '', picture: null }, { id: 'person' });
    await store.batch([
      { type: 'create', kind: 'chat', id: 'a', parent: null, value: { ...chat, persona: 'person' } },
      { type: 'create', kind: 'entry', id: 'a1', parent: 'a', value: message('{{user}}') },
    ]);
    const release = await hold(store, 'a');
    const read = new ReadModels(store);
    const seen: string[] = [];
    read.chat('a').subscribe(() => { const text = read.chat('a').snapshot()?.display.texts[0]; if (text) seen.push(text); });
    const display = store.evaluation.display.bind(store.evaluation);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let started = false;
    vi.spyOn(store.evaluation, 'display').mockImplementationOnce(async (...args) => {
      const result = await display(...args);
      started = true;
      await gate;
      return result;
    });
    const old = store.update('persona', 'person', (value) => ({ ...value, name: 'obsolete' }));
    await vi.waitFor(() => expect(started).toBe(true));
    const latest = store.update('persona', 'person', (value) => ({ ...value, name: 'latest' }));
    await vi.waitFor(() => expect(store.get('persona', 'person')?.value.name).toBe('latest'));
    finish();
    await Promise.all([old, latest]);
    await store.evaluated('a');
    expect(seen).toEqual(['latest']);
    await store.saveSummary('a');
    expect(read.summary('a').snapshot()?.preview).toBe('latest');
    read.close();
    release();
    store.close();
  });

  it('keeps transient sent messages stable across chunks and resizes only the open chat', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('latest: {{lastmessage}}'), { parent: 'a' });
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    const talk = liveTalk();
    const opening = { chat, messages: [] };
    const screen = read.screen('a', talk, opening);
    const leave = screen.subscribe(() => {});
    await hold(store, screen.id);
    screen.setInputs(opening, { width: 800, height: 600 });
    await vi.waitFor(() => expect(screen.snapshot().pending).not.toBe(true));
    const displayed = vi.spyOn(store.evaluation, 'display');
    const first = screen.snapshot();
    // A composer or panel render has new wrapper objects, not new display inputs.
    screen.setInputs({ ...opening }, { width: 800, height: 600 });
    expect(screen.snapshot()).toBe(first);
    expect(screen.snapshot()).toBe(first);
    expect(displayed).not.toHaveBeenCalled();
    const turn: Turn = { chat: 'a', said: { id: 'said', text: 'question' }, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: 'one', reasoning: '' };
    talk.set(turn);
    await vi.waitFor(() => expect(screen.snapshot().display.texts[0]).toBe('latest: one'));
    const chunk = screen.snapshot();
    talk.set({ ...turn, text: 'one two' });
    await vi.waitFor(() => expect(screen.snapshot().display.texts[0]).toBe('latest: one two'));
    const next = screen.snapshot();
    expect(displayed.mock.calls.map(([lane]) => lane.split(':').at(-1))).toEqual(['a', 'a']);
    expect(next.display.texts[0]).toBe('latest: one two');
    expect(next.messages[0]).toBe(chunk.messages[0]);
    expect(next.messages[1]).toBe(chunk.messages[1]);
    expect(next.messages[2]).not.toBe(chunk.messages[2]);
    screen.setInputs({ ...opening }, { width: 800, height: 600 });
    expect(screen.snapshot()).toBe(next);
    expect(displayed).toHaveBeenCalledTimes(2);
    const b = read.chat('b').snapshot();
    screen.setInputs(opening, { width: 900, height: 600 });
    expect(displayed.mock.calls.map(([lane]) => lane.split(':').at(-1))).toEqual(['a', 'a', 'a']);
    expect(read.chat('b').snapshot()).toBe(b);
    leave();
    read.close();
  });

  it('emits kind/id/parent for batch, remove, restore and paginated pull, and ignores stale echoes', async () => {
    const { store, open } = await account();
    const observed: StoreChange[][] = [];
    store.subscribe((changes) => {
      const objects = changes.filter((change) => change.kind === 'chat' || change.kind === 'entry');
      if (objects.length) observed.push(objects);
    });
    await hold(store, 'c');
    await store.batch([
      { type: 'create', kind: 'chat', id: 'c', parent: null, value: chat },
      { type: 'create', kind: 'entry', id: 'e', parent: 'c', value: message('hi') },
    ]);
    expect(observed).toEqual([[{ kind: 'entry', id: 'e', parent: 'c' }, { kind: 'chat', id: 'c', parent: null }]]);
    const entry = store.get('entry', 'e')!;
    await store.pull();
    expect(observed).toHaveLength(1);
    await store.remove('e');
    await store.restore(entry);
    expect(observed.slice(1)).toEqual([[{ kind: 'entry', id: 'e', parent: 'c' }], [{ kind: 'entry', id: 'e', parent: 'c' }]]);
    const phone = await open();
    for (let index = 0; index < 3; index++) await phone.create('entry', message('remote'), { id: `r${index}`, parent: 'c' });
    observed.length = 0;
    await store.pull();
    expect(observed.flat()).toEqual([0, 1, 2].map((index) => ({ kind: 'entry', id: `r${index}`, parent: 'c' })));
  });

  it('serves unsaved greetings and a first live turn while the same id becomes stored', async () => {
    const { store } = await account();
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    const talk = liveTalk();
    const greeting: chatModel.Message = { id: 'opening', role: 'assistant', at: 0, versions: [{ id: 'g', seed: 'g', text: '{{screenwidth}}', receipt: null, edited: false, at: 0 }], selected: 0 };
    const opening = { chat, messages: [greeting] };
    const screen = read.screen('new', talk, opening);
    const leave = screen.subscribe(() => {});
    await hold(store, screen.id);
    screen.setInputs(opening, { width: 800, height: 600 });
    await vi.waitFor(() => expect(screen.snapshot().display.texts).toEqual(['800']));
    expect((await read.displayed('new'))?.display.texts).toEqual(['{{screenwidth}}']);
    const displayed = vi.spyOn(store.evaluation, 'display');
    await read.displayed('new');
    expect(displayed).not.toHaveBeenCalled();
    talk.set({ chat: 'new', said: { id: 'said', text: 'hi' }, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: 'hello', reasoning: '' });
    await vi.waitFor(() => expect(screen.snapshot().messages.map((message) => message.id)).toEqual(['opening', 'said', 'reply']));
    await store.batch([
      { type: 'create', kind: 'entry', id: 'g', parent: 'new', value: { ...message('{{screenwidth}}'), role: 'assistant' } },
      { type: 'create', kind: 'chat', id: 'new', parent: null, value: chat },
    ]);
    await vi.waitFor(() => expect(screen.snapshot().messages.map((message) => message.id)).toEqual(['g', 'said', 'reply']));
    expect(screen.snapshot().display.texts).toEqual(['800', 'hi', 'hello']);
    expect((await read.displayed('new'))?.display.texts).toEqual(['{{screenwidth}}']);
    leave();
    read.close();
  });

  it('lists a kind by name, so an edited one keeps its place', async () => {
    const { store } = await account();
    for (const name of ['나', '가', '다']) await store.create('persona', { name, description: '', picture: null }, { id: name });
    const read = new ReadModels(store);
    const names = () => read.kind('persona').snapshot().map(({ value }) => value.name);
    expect(names()).toEqual(['가', '나', '다']);
    await store.update('persona', '가', (current) => ({ ...current, alias: '별명' }));
    expect(names()).toEqual(['가', '나', '다']);
    read.close();
  });

  it('keeps populated chat order on rename and unchanged summaries on dependency writes', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('a first'), { id: 'a1', parent: 'a' });
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    await store.update('chat', 'b', (current) => ({ ...current, title: 'renamed' }));
    await vi.waitFor(() => expect(read.chats.snapshot().map(({ id }) => id)).toEqual(['b', 'a']));
    // Empty chats use their own rev; once entries exist, only entries determine their recency.
    await store.create('entry', message('b first'), { id: 'b1', parent: 'b' });
    const messages = read.chat('a').snapshot()?.messages;
    await store.update('chat', 'a', (current) => ({ ...current, title: 'A' }));
    expect(read.chats.snapshot().map(({ id }) => id)).toEqual(['b', 'a']);
    expect(read.chat('a').snapshot()?.messages).toBe(messages);
    await store.saveSummary('a');
    await store.saveSummary('b');
    const summaries = read.chats.snapshot();
    const library = read.library.snapshot();
    await store.upsert('settings', () => ({ models: {} }));
    expect(read.chats.snapshot()).toBe(summaries);
    expect(read.library.snapshot()).toBe(library);
    expect(read.chat('a').snapshot()?.messages).toBe(messages);
    read.close();
  });

  it('reads a deleted chat as gone from its character, the chat list and its screen, and 되돌리기 brings it back whole', async () => {
    const { store } = await account();
    await store.create('character', { card: card('루나'), folder: null, loreFolders: [] }, { id: 'ca' });
    await store.create('chat', { ...chat, character: 'ca' }, { id: 'a' });
    await store.create('chat', { ...chat, character: 'ca' }, { id: 'b' });
    await store.create('entry', message('a first'), { id: 'a1', parent: 'a' });
    await hold(store, 'a', 'b');
    const read = new ReadModels(store);
    const lists = () => [read.chats.snapshot(), read.library.snapshot().characters[0]!.chats].map((list) => list.map(({ id }) => id).toSorted());
    const texts = () => read.chat('a').snapshot()?.messages.map((message) => chatModel.shown(message).text);
    expect([lists(), texts()]).toEqual([[['a', 'b'], ['a', 'b']], ['a first']]);

    await removeChat(store, 'a');
    expect([lists(), read.summary('a').snapshot(), read.chat('a').snapshot()]).toEqual([[['b'], ['b']], null, null]);
    await restoreChat(store, 'a');
    expect([lists(), texts(), read.summary('a').snapshot()?.count]).toEqual([[['a', 'b'], ['a', 'b']], ['a first'], 1]);
    read.close();
  });

  it('lists in 휴지통 the deleted chats of a character not deleted or of none, never those of a deleted character', async () => {
    const { store } = await account();
    await store.create('character', { card: card('루나'), folder: null, loreFolders: [] }, { id: 'ca' });
    await store.create('character', { card: card('해나'), folder: null, loreFolders: [], deleted: Date.now() }, { id: 'cd' });
    await store.create('chat', { ...chat, character: 'ca', title: '등대' }, { id: 'a' });
    await store.create('chat', { ...chat, character: 'cd' }, { id: 'd' });
    await store.create('chat', chat, { id: 'n' });
    const read = new ReadModels(store);
    const binned = () => read.library.snapshot().deletedChats.map(({ id, title }) => [id, title]).toSorted();
    for (const id of ['a', 'd', 'n']) await removeChat(store, id);
    expect([binned(), read.chats.snapshot(), read.summary('a').snapshot()]).toEqual([[['a', '등대'], ['n', expect.any(String)]], [], null]);

    await restoreChat(store, 'a');
    expect([binned(), read.chats.snapshot().map(({ id }) => id)]).toEqual([[['n', expect.any(String)]], ['a']]);
    read.close();
  });
});
