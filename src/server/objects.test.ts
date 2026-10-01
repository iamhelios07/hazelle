import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BATCH_LIMITS } from './objects';
import { sessionCookie, signupBody, testApp } from './testing';

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
  return sessionCookie(await t.post('signup', signupBody()));
}

async function sync(cookie: string, since = 0): Promise<Page> {
  const { limits, ...page } = (await (await t.get(`objects?since=${since}`, cookie)).json()) as Page & { limits: typeof BATCH_LIMITS };
  expect(limits).toEqual(BATCH_LIMITS);
  return page;
}

async function write(cookie: string, id: string, input: Record<string, unknown>) {
  const response = await t.post('objects/batch', { writes: [{ id, parent: null, baseRev: null, ...input }] }, cookie);
  return { status: response.status, json: (await response.json()) as { revs?: number[]; error?: string } };
}

describe('objects', () => {
  it('rejects a cursor newer than the restored account instead of answering an empty feed', async () => {
    const cookie = await signedIn();
    await write(cookie, A, { kind: 'settings', body: 'sealed' });
    const response = await t.get('objects?since=2&exclude=entry,memory', cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'cache-reset' });
  });

  it('refuses a device feed for an account other than its authenticated session', async () => {
    const cookie = await signedIn();
    const response = await t.get(`objects?since=0&account=${A}`, cookie);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'account-mismatch' });
  });

  it('bootstraps without scoped kinds, feeds omitted revisions and deletions, and reads only the requested parent', async () => {
    const cookie = await signedIn();
    const C = crypto.randomUUID();
    const D = crypto.randomUUID();
    const E = crypto.randomUUID();
    const F = crypto.randomUUID();
    await write(cookie, A, { kind: 'chat', body: 'chat-a' });
    await write(cookie, B, { kind: 'entry', parent: A, body: 'entry-a' });
    await write(cookie, C, { kind: 'memory', parent: A, body: 'memory-a' });
    await write(cookie, D, { kind: 'chat', body: 'chat-b' });
    await write(cookie, E, { kind: 'entry', parent: D, body: 'entry-b' });
    const bootstrap = await (await t.get('objects?since=0&exclude=entry,memory&bootstrap=1', cookie)).json();
    expect(bootstrap).toMatchObject({ until: 5, more: false, changes: [
      { id: A, kind: 'chat', body: 'chat-a' }, { id: D, kind: 'chat', body: 'chat-b' },
    ] });
    await write(cookie, B, { kind: 'entry', parent: A, body: 'new-entry', baseRev: 2 });
    await write(cookie, C, { kind: 'memory', parent: A, body: null, baseRev: 3 });
    await write(cookie, F, { kind: 'summary', parent: A, body: 'new-summary' });
    const feed = await (await t.get('objects?since=5&exclude=entry,memory', cookie)).json();
    expect(feed).toMatchObject({ cursor: 8, more: false, changes: [
      { id: B, kind: 'entry', parent: A, rev: 6, omitted: true },
      { id: C, kind: 'memory', parent: A, rev: 7, body: null },
      { id: F, kind: 'summary', parent: A, rev: 8, body: 'new-summary' },
    ] });
    expect(JSON.stringify(feed)).not.toContain('new-entry');
    expect(await (await t.get(`objects?since=0&parent=${A}`, cookie)).json()).toMatchObject({ changes: [
      { id: B, body: 'new-entry' }, { id: C, body: null }, { id: F, body: 'new-summary' },
    ] });
  });

  it('creates, updates with a version check, and syncs from a cursor', async () => {
    const cookie = await signedIn();
    expect(await write(cookie, A, { kind: 'settings', body: 'b25l' })).toEqual({ status: 200, json: { revs: [1] } });
    expect(await write(cookie, B, { kind: 'connection', parent: A, body: 'dHdv' })).toEqual({ status: 200, json: { revs: [2] } });

    expect(await write(cookie, A, { kind: 'settings', body: 'bmV3', baseRev: 1 })).toEqual({ status: 200, json: { revs: [3] } });
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
    expect((await t.post('objects/batch', { writes: [{ id: A, kind: 'connection', parent: null, body: null, baseRev: 2 }] }, cookie)).status).toBe(409);
    const deleted = await t.post('objects/batch', { writes: [{ id: A, kind: 'connection', parent: null, body: null, baseRev: 1 }] }, cookie);
    expect(await deleted.json()).toEqual({ revs: [2] });
    expect((await sync(cookie, 1)).changes).toEqual([{ id: A, kind: 'connection', parent: null, rev: 2, body: null }]);

    expect(await write(cookie, A, { kind: 'connection', body: 'a2V5', baseRev: 2 })).toEqual({ status: 200, json: { revs: [3] } });
    expect((await sync(cookie, 2)).changes).toEqual([{ id: A, kind: 'connection', parent: null, rev: 3, body: 'a2V5' }]);
  });

  it('refuses an update that moves an object to another parent, and restores a child under its own', async () => {
    const cookie = await signedIn();
    const C = '33333333-3333-4333-8333-333333333333';
    await write(cookie, A, { kind: 'chat', body: 'YQ==' });
    await write(cookie, B, { kind: 'chat', body: 'Yg==' });
    expect(await write(cookie, C, { kind: 'entry', parent: A, body: 'Yw==' })).toEqual({ status: 200, json: { revs: [3] } });
    expect(await write(cookie, C, { kind: 'entry', parent: B, body: 'ZA==', baseRev: 3 })).toEqual({ status: 400, json: { error: 'bad-input' } });
    expect(await write(cookie, C, { kind: 'entry', body: 'ZA==', baseRev: 3 })).toEqual({ status: 400, json: { error: 'bad-input' } });

    const deleted = await t.post('objects/batch', { writes: [{ id: C, kind: 'entry', parent: A, body: null, baseRev: 3 }] }, cookie);
    expect(await deleted.json()).toEqual({ revs: [4] });
    expect(await write(cookie, C, { kind: 'entry', parent: B, body: 'Yw==', baseRev: 4 })).toEqual({ status: 400, json: { error: 'bad-input' } });
    expect(await write(cookie, C, { kind: 'entry', parent: A, body: 'Yw==', baseRev: 4 })).toEqual({ status: 200, json: { revs: [5] } });
    expect((await sync(cookie, 4)).changes).toEqual([{ id: C, kind: 'entry', parent: A, rev: 5, body: 'Yw==' }]);
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
    expect((await write(cookie, 'not-a-uuid', { kind: 'settings', body: 'eA==' })).status).toBe(400);
    expect((await write(cookie, A, { kind: 'Settings', body: 'eA==' })).status).toBe(400);
    expect((await write(cookie, A, { kind: 'lore', parent: 'x', body: 'eA==' })).status).toBe(400);
    expect((await write(cookie, A, { kind: 'settings', body: 'eA==', baseRev: 0 })).status).toBe(400);
    expect((await write(cookie, A, { kind: 'settings', body: 'x'.repeat(1_500_001) })).status).toBe(413);
    expect((await t.get('objects?since=-1', cookie)).status).toBe(400);
    expect((await t.get('objects?since=0')).status).toBe(401);
  });

  it('pages many objects by row count with a lookahead and no extra final page', async () => {
    const cookie = await signedIn();
    await t.env.DB.prepare(`WITH RECURSIVE revisions(rev) AS (
      SELECT 1 UNION ALL SELECT rev + 1 FROM revisions WHERE rev < 2000
    ) INSERT INTO objects (account_id, id, kind, rev, body)
      SELECT accounts.id, printf('%08d-1111-4111-8111-111111111111', revisions.rev), 'entry', revisions.rev, 'body-' || revisions.rev
      FROM accounts CROSS JOIN revisions`).run();
    await t.env.DB.prepare('UPDATE accounts SET rev = 2000').run();
    const changes = (since: number) => Array.from({ length: 500 }, (_, index) => {
      const rev = since + index + 1;
      return { id: `${String(rev).padStart(8, '0')}-1111-4111-8111-111111111111`, kind: 'entry', parent: null, rev, body: `body-${rev}` };
    });

    expect(await sync(cookie, 500)).toEqual({ changes: changes(500), cursor: 1000, more: true });
    expect(await sync(cookie, 1500)).toEqual({ changes: changes(1500), cursor: 2000, more: false });
    expect(await sync(cookie, 2000)).toEqual({ changes: [], cursor: 2000, more: false });
  });

  it('refuses a later conflict or invalid item without writing earlier items or advancing the account rev', async () => {
    const cookie = await signedIn();
    await write(cookie, A, { kind: 'chat', body: 'original' });
    const first = { id: B, kind: 'entry', parent: A, body: 'new', baseRev: null };
    const send = (last: unknown) => t.post('objects/batch', { writes: [first, last] }, cookie);
    const current = { id: A, kind: 'chat', parent: null, body: 'changed', baseRev: 2 };
    expect((await send(current)).status).toBe(409);
    expect((await send({ ...current, parent: B, baseRev: 1 })).status).toBe(400);
    expect((await send({ ...current, body: '' })).status).toBe(400);
    expect((await send(first)).status).toBe(400);
    expect((await sync(cookie)).changes).toEqual([{ id: A, kind: 'chat', parent: null, rev: 1, body: 'original' }]);
    expect(await t.env.DB.prepare('SELECT rev FROM accounts').first('rev')).toBe(1);
    const response = await send({ ...current, baseRev: 1 });
    expect(await response.json()).toEqual({ revs: [2, 3] });
    expect((await sync(cookie)).changes.map(({ id, rev }) => [id, rev])).toEqual([[B, 2], [A, 3]]);
  });

  it('enforces item and UTF-8 body budgets, including a streamed request without content-length', async () => {
    const cookie = await signedIn();
    const item = () => ({ id: crypto.randomUUID(), kind: 'entry', parent: null, body: 'x', baseRev: null });
    expect((await t.post('objects/batch', { writes: [] }, cookie)).status).toBe(400);
    expect((await t.post('objects/batch', { writes: Array.from({ length: BATCH_LIMITS.items + 1 }, item) }, cookie)).status).toBe(413);
    expect((await t.post('objects/batch', { writes: [{ ...item(), body: '한'.repeat(500_001) }] }, cookie)).status).toBe(413);
    const body = JSON.stringify({ writes: Array.from({ length: 3 }, () => ({ ...item(), body: 'x'.repeat(1_400_000) })) });
    expect((await t.raw('objects/batch', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body })).status).toBe(413);
    expect(await t.env.DB.prepare('SELECT rev FROM accounts').first('rev')).toBe(0);
    const accepted = await t.post('objects/batch', { writes: Array.from({ length: BATCH_LIMITS.items }, item) }, cookie);
    expect(await accepted.json()).toEqual({ revs: Array.from({ length: BATCH_LIMITS.items }, (_, index) => index + 1) });
    expect((await t.post('objects/batch', { writes: [item()] })).status).toBe(401);
  });
});
