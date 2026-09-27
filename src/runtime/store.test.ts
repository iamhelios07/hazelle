import { describe, expect, it } from 'vitest';
import { randomBytes } from '../vault/aead';
import type { ApiResult } from './api';
import { ObjectStore } from './store';

type Row = { id: string; kind: string; parent: string | null; rev: number; body: string | null };

// The server's object routes in memory: the same version checks, without D1.
function fakeServer() {
  const rows = new Map<string, Row>();
  let rev = 0;
  async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const ok = (data: unknown) => ({ ok: true, data }) as ApiResult<T>;
    if (method === 'GET') {
      const since = Number(path.split('since=')[1]);
      const changes = [...rows.values()].filter((row) => row.rev > since).sort((a, b) => a.rev - b.rev);
      return ok({ changes, cursor: changes.at(-1)?.rev ?? since, more: false });
    }
    const id = path.split('/')[1]!;
    const input = body as { kind: string; parent?: string | null; body?: string; baseRev: number | null };
    const row = rows.get(id);
    const matches = input.baseRev === null ? !row : row?.rev === input.baseRev && row.kind === input.kind && (method === 'PUT' || row.body !== null);
    if (!matches) return { ok: false, error: 'conflict' };
    rows.set(id, { id, kind: input.kind, parent: input.parent ?? null, rev: ++rev, body: method === 'PUT' ? input.body! : null });
    return ok({ rev });
  }
  return { request, rows };
}

const ACCOUNT = 'account-1';

describe('object store', () => {
  it('shares writes between devices and reapplies a change after a conflict', async () => {
    const server = fakeServer();
    const vaultKey = randomBytes(32);
    const laptop = await ObjectStore.open(ACCOUNT, vaultKey, server.request);
    const phone = await ObjectStore.open(ACCOUNT, vaultKey, server.request);

    await laptop.save<{ starred: string[] }>('connection', 'c1', () => ({ starred: ['a'] }));
    await phone.pull();
    expect(phone.get('c1')?.value).toEqual({ starred: ['a'] });

    await laptop.save<{ starred: string[] }>('connection', 'c1', (current) => ({ starred: [...current!.starred, 'b'] }));
    const saved = await phone.save<{ starred: string[] }>('connection', 'c1', (current) => ({ starred: [...current!.starred, 'c'] }));
    expect(saved.ok && saved.data.value).toEqual({ starred: ['a', 'b', 'c'] });
    await laptop.pull();
    expect(laptop.get('c1')?.value).toEqual({ starred: ['a', 'b', 'c'] });
  });

  it('removes an object everywhere and restores it by saving it again', async () => {
    const server = fakeServer();
    const vaultKey = randomBytes(32);
    const laptop = await ObjectStore.open(ACCOUNT, vaultKey, server.request);
    const phone = await ObjectStore.open(ACCOUNT, vaultKey, server.request);
    await laptop.save('connection', 'c1', () => ({ label: 'OpenRouter' }));
    await phone.pull();

    expect(await laptop.remove('c1')).toEqual({ ok: true, data: null });
    await phone.pull();
    expect(phone.list('connection')).toEqual([]);

    expect((await phone.save('connection', 'c1', () => ({ label: 'OpenRouter' }))).ok).toBe(true);
    await laptop.pull();
    expect(laptop.get('c1')?.value).toEqual({ label: 'OpenRouter' });
  });

  it('counts a body it cannot open and refuses to overwrite it', async () => {
    const server = fakeServer();
    const mine = await ObjectStore.open(ACCOUNT, randomBytes(32), server.request);
    const stranger = await ObjectStore.open(ACCOUNT, randomBytes(32), server.request);
    await stranger.save('connection', 'c1', () => ({ label: 'x' }));

    await mine.pull();
    expect(mine.list('connection')).toEqual([]);
    expect(mine.unreadable()).toBe(1);
    expect(await mine.save('connection', 'c1', () => ({ label: 'y' }))).toEqual({ ok: false, error: 'unreadable' });
  });
});
