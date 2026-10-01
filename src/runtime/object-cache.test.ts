import { afterEach, expect, it, vi } from 'vitest';
import { randomBytes } from '../vault/aead';
import { lockVault } from '../vault/device';
import { objectKey, sealObject } from '../vault/objects';
import { api } from './api';
import { forgetVault } from './device-cache';
import type { SealedChange } from './object-cache';
import { openSession } from './session';
import { ObjectStore } from './store';
import { MemoryCache } from './testing/cache';

vi.mock('../vault/device', () => ({ lockVault: vi.fn(async () => {}) }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const limits = { items: 100, bytes: 1_000_000, body: 100_000 };
const connection = { type: 'openrouter', label: 'cached', baseUrl: null, protocol: null, secret: 'secret', starred: [] } as const;

async function fixture() {
  const vault = randomBytes(32);
  const key = await objectKey(vault);
  const cache = new MemoryCache();
  let rev = 0;
  const rows = new Map<string, SealedChange>();
  const add = async (id: string, kind: string, parent: string | null, value: unknown) => {
    const row = { id, kind, parent, rev: ++rev, body: value === null ? null : await sealObject(key, 'account', { id, kind, parent }, value) };
    rows.set(id, row);
    return row;
  };
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    const url = new URL(path, 'https://test');
    if (init.method === 'POST') {
      const { writes } = JSON.parse(init.body as string) as { writes: Omit<SealedChange, 'rev'>[] };
      const revs = writes.map((write) => {
        rows.set(write.id, { ...write, rev: ++rev });
        return rev;
      });
      return Response.json({ revs });
    }
    const since = Number(url.searchParams.get('since'));
    if (Math.max(since, Number(url.searchParams.get('known'))) > rev) return Response.json({ error: 'cache-reset' }, { status: 409 });
    const parent = url.searchParams.get('parent');
    const bootstrap = url.searchParams.has('bootstrap');
    const changes = [...rows.values()].filter((row) => row.rev > since && (parent === null || row.parent === parent)).flatMap((row) => {
      if (!url.searchParams.has('exclude') || !['entry', 'memory'].includes(row.kind)) return [row];
      if (bootstrap) return [];
      const { body, ...metadata } = row;
      return [body === null ? row : { ...metadata, omitted: true as const }];
    }).sort((a, b) => a.rev - b.rev);
    return Response.json({ changes, cursor: changes.at(-1)?.rev ?? since, more: false, limits, ...(bootstrap ? { until: rev } : {}) });
  });
  vi.stubGlobal('fetch', fetch);
  const open = () => ObjectStore.open('account', vault, api, cache);
  const flush = async () => { await vi.waitFor(() => expect(cache.states.get('')?.cursor).toBe(rev)); };
  return { vault, cache, rows, add, fetch, open, flush, wipe: () => { rows.clear(); rev = 0; } };
}

it('reopens a session with sealed cached objects before any network read', async () => {
  const f = await fixture();
  const sealed = await f.add('connection', 'connection', null, connection);
  const first = await f.open();
  await first.pull();
  await f.flush();
  first.close();
  expect(f.cache.rows.get('connection')).toEqual(sealed);
  expect(JSON.stringify(f.cache.rows.get('connection'))).not.toContain('secret');
  f.fetch.mockClear();
  f.fetch.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const opened = await openSession('account', f.vault, 'jin', new AbortController().signal, undefined, f.cache);
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(opened.data.store.get('connection', 'connection')?.value.label).toBe('cached');
  expect(f.fetch).not.toHaveBeenCalled();
  opened.data.startBackground();
  expect(f.fetch).toHaveBeenCalledWith('/api/objects?since=1&exclude=entry,memory&account=account&known=1', expect.anything());
  opened.data.close();
});

it('renders a saved bootstrap prefix and resumes its original until bound in the background', async () => {
  const f = await fixture();
  await f.add('first', 'connection', null, connection);
  await f.add('second', 'connection', null, connection);
  const respond = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementationOnce(async (...args) => {
    const data = await (await respond(...args)).json() as { changes: SealedChange[] };
    return Response.json({ ...data, changes: data.changes.slice(0, 1), cursor: 1, more: true });
  }).mockImplementationOnce(async () => Response.json({ error: 'offline' }, { status: 503 }));
  const first = await f.open();
  expect(await first.pull()).toMatchObject({ error: 'offline' });
  await vi.waitFor(() => expect(f.cache.states.get('')).toMatchObject({ cursor: 1, until: 2, complete: false }));
  first.close();
  f.fetch.mockClear();
  f.fetch.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const opened = await openSession('account', f.vault, 'jin', new AbortController().signal, undefined, f.cache);
  if (!opened.ok) throw new Error(opened.error);
  expect(opened.data.store.list('connection').map((row) => row.id)).toEqual(['first']);
  expect(f.fetch).not.toHaveBeenCalled();
  opened.data.startBackground();
  expect(f.fetch.mock.lastCall?.[0]).toBe('/api/objects?since=1&exclude=entry,memory&bootstrap=1&until=2&account=account&known=2');
  opened.data.close();
});

it('settles a retained cached chat before its parent catch-up, then applies newer entries', async () => {
  const f = await fixture();
  await f.add('chat', 'chat', null, { title: null, character: null, models: {} });
  await f.add('old', 'entry', 'chat', { type: 'delete', message: 'old', at: 1 });
  const store = await f.open();
  await store.pull();
  const first = store.retainChat('chat');
  expect(await first.ready).toBeNull();
  first.release();
  await f.add('new', 'entry', 'chat', { type: 'delete', message: 'new', at: 2 });
  const respond = f.fetch.getMockImplementation()!;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { resume = resolve; });
  f.fetch.mockImplementation(async (...args) => { await waiting; return respond(...args); });
  const next = store.retainChat('chat');
  expect(await next.ready).toBeNull();
  expect(store.children('entry', 'chat').map((row) => row.id)).toEqual(['old']);
  expect(f.fetch.mock.lastCall?.[0]).toContain('since=2&parent=chat');
  resume();
  await vi.waitFor(() => expect(store.children('entry', 'chat').map((row) => row.id)).toEqual(['old', 'new']));
  next.release();
  store.close();
});

it('does not serve an unloaded chat deletion from the cache on its next retain', async () => {
  const f = await fixture();
  await f.add('entry', 'entry', 'chat', { type: 'delete', message: 'old', at: 1 });
  const store = await f.open();
  await store.pull();
  const first = store.retainChat('chat');
  await first.ready;
  first.release();
  await f.add('entry', 'entry', 'chat', null);
  await store.pull();
  f.fetch.mockImplementation(() => new Promise(() => {}));
  const next = store.retainChat('chat');
  expect(await next.ready).toBeNull();
  expect(store.children('entry', 'chat')).toEqual([]);
  next.release();
  store.close();
});

it('requires a parent catch-up when an unloaded cached body was omitted by the main feed', async () => {
  const f = await fixture();
  await f.add('memory', 'memory', 'chat', { records: [], state: [], threads: [] });
  const store = await f.open();
  await store.pull();
  const first = store.retainChat('chat');
  await first.ready;
  first.release();
  await f.add('memory', 'memory', 'chat', { records: [], state: [], threads: [{ id: 'new', text: 'new', opened: null }] });
  await store.pull();
  const respond = f.fetch.getMockImplementation()!;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { resume = resolve; });
  f.fetch.mockImplementation(async (...args) => { await waiting; return respond(...args); });
  const next = store.retainChat('chat');
  await vi.waitFor(() => expect(f.fetch.mock.lastCall?.[0]).toContain('since=1&parent=chat'));
  expect(() => store.children('memory', 'chat')).toThrow('not loaded');
  resume();
  expect(await next.ready).toBeNull();
  expect(store.children('memory', 'chat')[0]?.value.threads[0]?.id).toBe('new');
  next.release();
  store.close();
});

it('drops the cached account instead of merging when server revisions go backwards', async () => {
  const f = await fixture();
  await f.add('connection', 'connection', null, connection);
  const first = await f.open();
  await first.pull();
  await f.flush();
  first.close();
  const reopened = await f.open();
  expect(reopened.get('connection', 'connection')).not.toBeNull();
  f.wipe();
  expect(await reopened.pull()).toBeNull();
  expect(reopened.list('connection')).toEqual([]);
  await vi.waitFor(() => expect(f.cache.rows.size).toBe(0));
  expect(f.cache.states.get('')?.cursor).toBe(0);
  reopened.close();
});

it('forgets the account cache together with its remembered vault on logout', async () => {
  const f = await fixture();
  await f.add('connection', 'connection', null, connection);
  const store = await f.open();
  await store.pull();
  await f.flush();
  store.close();
  await forgetVault('account', f.cache);
  expect(lockVault).toHaveBeenCalled();
  expect(await f.cache.read()).toBeNull();
  expect(f.cache.rows.size).toBe(0);
});

it('does not await a cache write or fail a successful object write when caching fails', async () => {
  const f = await fixture();
  const store = await f.open();
  await store.pull();
  await f.flush();
  let reject!: (reason: Error) => void;
  const writing = vi.spyOn(f.cache, 'write').mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const saved = await store.create('connection', { ...connection, starred: [] });
  expect(saved.ok).toBe(true);
  await vi.waitFor(() => expect(writing).toHaveBeenCalledOnce());
  const write = writing.mock.calls[0]![0].changes[0]!;
  expect(write.body).toBe(f.rows.get(write.id)?.body);
  reject(new Error('quota'));
  expect((await store.create('connection', { ...connection, starred: [] })).ok).toBe(true);
  store.close();
});
