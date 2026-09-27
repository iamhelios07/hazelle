import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sessionCookie, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

type Page = { changes: { id: string; kind: string; parent: string | null; rev: number; body: string | null }[]; cursor: number; more: boolean };

async function signedIn() {
  return sessionCookie(await t.post('signup', { username: 'jin', password: 'correct horse' }));
}

async function sync(cookie: string, since = 0): Promise<Page> {
  return (await (await t.get(`objects?since=${since}`, cookie)).json()) as Page;
}

async function write(cookie: string, id: string, input: Record<string, unknown>) {
  const response = await t.put(`objects/${id}`, input, cookie);
  return { status: response.status, json: (await response.json()) as { rev?: number; error?: string } };
}

describe('objects', () => {
  it('creates, updates with a version check, and syncs from a cursor', async () => {
    const cookie = await signedIn();
    expect(await write(cookie, A, { kind: 'settings', body: 'b25l' })).toEqual({ status: 200, json: { rev: 1 } });
    expect(await write(cookie, B, { kind: 'connection', parent: A, body: 'dHdv' })).toEqual({ status: 200, json: { rev: 2 } });

    expect(await write(cookie, A, { kind: 'settings', body: 'bmV3', baseRev: 1 })).toEqual({ status: 200, json: { rev: 3 } });
    expect(await write(cookie, A, { kind: 'settings', body: 'c3RhbGU=', baseRev: 1 })).toEqual({ status: 409, json: { error: 'conflict' } });
    expect(await write(cookie, A, { kind: 'settings', body: 'YWdhaW4=' })).toEqual({ status: 409, json: { error: 'conflict' } });
    expect(await write(cookie, A, { kind: 'connection', body: 'a2luZA==', baseRev: 3 })).toEqual({ status: 409, json: { error: 'conflict' } });

    expect(await sync(cookie)).toEqual({
      changes: [
        { id: B, kind: 'connection', parent: A, rev: 2, body: 'dHdv' },
        { id: A, kind: 'settings', parent: null, rev: 3, body: 'bmV3' },
      ],
      cursor: 3,
      more: false,
    });
    expect(await sync(cookie, 2)).toEqual({ changes: [{ id: A, kind: 'settings', parent: null, rev: 3, body: 'bmV3' }], cursor: 3, more: false });
    expect(await sync(cookie, 3)).toEqual({ changes: [], cursor: 3, more: false });
  });

  it('deletes to a bodiless row that syncs, and restores by writing it again', async () => {
    const cookie = await signedIn();
    await write(cookie, A, { kind: 'connection', body: 'a2V5' });
    expect((await t.delete(`objects/${A}`, { kind: 'connection', baseRev: 2 }, cookie)).status).toBe(409);
    const deleted = await t.delete(`objects/${A}`, { kind: 'connection', baseRev: 1 }, cookie);
    expect(await deleted.json()).toEqual({ rev: 2 });
    expect((await sync(cookie, 1)).changes).toEqual([{ id: A, kind: 'connection', parent: null, rev: 2, body: null }]);

    expect(await write(cookie, A, { kind: 'connection', body: 'a2V5', baseRev: 2 })).toEqual({ status: 200, json: { rev: 3 } });
    expect((await sync(cookie, 2)).changes).toEqual([{ id: A, kind: 'connection', parent: null, rev: 3, body: 'a2V5' }]);
  });

  it('pages a large sync by body size and never shows another account', async () => {
    const cookie = await signedIn();
    const big = 'x'.repeat(1_400_000);
    const ids = ['33333333-3333-4333-8333-33333333333', '44444444-4444-4444-8444-44444444444'].flatMap((prefix) => [`${prefix}1`, `${prefix}2`]);
    for (const id of ids) await write(cookie, id, { kind: 'entry', body: big });
    await t.env.DB.batch([
      t.env.DB.prepare("INSERT INTO accounts (id, username, login_hash, created_at, rev) VALUES ('other', 'other', '', 0, 1)"),
      t.env.DB.prepare(`INSERT INTO objects (account_id, id, kind, rev, body) VALUES ('other', '${B}', 'entry', 1, 'b3RoZXI=')`),
    ]);

    const first = await sync(cookie);
    expect(first.changes.map((change) => change.rev)).toEqual([1, 2, 3]);
    expect(first).toMatchObject({ cursor: 3, more: true });
    const second = await sync(cookie, first.cursor);
    expect(second.changes.map((change) => change.rev)).toEqual([4]);
    expect(second).toMatchObject({ cursor: 4, more: false });
  });

  it('refuses malformed writes, an oversized body and a missing session', async () => {
    const cookie = await signedIn();
    expect((await t.put('objects/not-a-uuid', { kind: 'settings', body: 'eA==' }, cookie)).status).toBe(400);
    expect((await t.put(`objects/${A}`, { kind: 'Settings', body: 'eA==' }, cookie)).status).toBe(400);
    expect((await t.put(`objects/${A}`, { kind: 'lore', parent: 'x', body: 'eA==' }, cookie)).status).toBe(400);
    expect((await t.put(`objects/${A}`, { kind: 'settings', body: 'eA==', baseRev: 0 }, cookie)).status).toBe(400);
    expect((await t.put(`objects/${A}`, { kind: 'settings', body: 'x'.repeat(1_500_001) }, cookie)).status).toBe(413);
    expect((await t.get('objects?since=-1', cookie)).status).toBe(400);
    expect((await t.get('objects?since=0')).status).toBe(401);
  });
});
