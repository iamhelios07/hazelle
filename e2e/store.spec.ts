import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { STORE_ADMIN } from './store-harness';

type Write = { id: string; kind: string; parent: string | null; body: string | null; baseRev: number | null };
type FeedQuery = { timeline: string | null; since: number; known: number; until: number | null; bootstrap: boolean; metadata: boolean; excluded: string[]; parent: string | null };
type FeedPage = { timeline: string; bytes?: number; changes: { id: string; rev: number; body?: string | null }[]; cursor: number; until: number; more: boolean };
type Actor = { accountId: string; cookie: string };
type Account = Actor & {
  incarnation: string;
  username: string;
  state: string;
  storage: { bytes: number | null; bytesCap: number | null; fileBytes: number; fileBytesCap: number | null };
};
type Ready = Account & { timeline: string };
type Inspection = {
  instance: string;
  reads: number;
  delay: number;
  tables: string[];
  head: { rev: number; bytes: number; timeline: string } | null;
  objects: number;
  keys: string[];
};
type Listing = {
  accounts: { accountId: string; state: string; bytes: number | null; disk: number | null; fileBytes: number }[];
  next: string | null;
};
type UsagePage = { accounts: number; totals: { bytes: number; disk: number; unread: number; readAt: number }; next: string | null };

const PROOF = Buffer.alloc(32, 7).toString('base64');
const headers = (actor: Actor) => ({ cookie: actor.cookie, 'x-account': actor.accountId });
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const write = (body: string, id: string = randomUUID()): Write => ({ id, kind: 'chat', parent: null, body, baseRev: null });
const query = (timeline: string | null = null): FeedQuery => ({ timeline, since: 0, known: 0, until: null, bootstrap: true, metadata: false, excluded: [], parent: null });
let operator: Actor;

async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), `${response.url()}: ${(await response.text()).slice(0, 300)}`).toBe(status);
  return response.json() as Promise<T>;
}

async function rpc<T>(request: APIRequestContext, incarnation: string, method: string, args: unknown[] = [incarnation]): Promise<T> {
  const result = await json<{ answer?: T; thrown?: string }>(await request.post('/__store-spec/rpc', { data: { incarnation, method, args } }));
  expect(result.thrown).toBeUndefined();
  expect(result).toHaveProperty('answer');
  return result.answer!;
}

const inspect = (request: APIRequestContext, account: Account) => rpc<Inspection>(request, account.incarnation, 'inspect', []);

async function restart(request: APIRequestContext, account: Account) {
  const result = await json<{ thrown?: string }>(await request.post('/__store-spec/rpc', {
    data: { incarnation: account.incarnation, method: 'restart', args: [account.incarnation] },
  }));
  expect(result.thrown).toEqual(expect.any(String));
}

async function signup(request: APIRequestContext, accountId: string = randomUUID()): Promise<Account> {
  const response = await request.post('/api/signup', {
    data: {
      accountId, username: `store-${randomUUID().slice(0, 18)}`,
      passwordProof: PROOF, recoveryProof: PROOF,
      passwordWrap: 'cGFzc3dvcmQgd3JhcA==', recoveryWrap: 'cmVjb3Zlcnkgd3JhcA==',
    },
  });
  const account = await json<Omit<Account, 'cookie'>>(response, 201);
  const cookie = response.headers()['set-cookie']?.split(';')[0];
  expect(cookie).toMatch(/^__Host-session=.+/);
  return { ...account, cookie: cookie! };
}

async function feed(request: APIRequestContext, account: Account, params: Record<string, string | number> = {}) {
  return request.get('/api/objects', { headers: headers(account), params: { since: 0, known: 0, bootstrap: 1, ...params } });
}

async function ready(request: APIRequestContext, accountId?: string): Promise<Ready> {
  const account = await signup(request, accountId);
  const page = await json<FeedPage>(await feed(request, account));
  expect(page.timeline).toMatch(/^[0-9a-f]{32}$/);
  return { ...account, timeline: page.timeline };
}

async function batch(request: APIRequestContext, account: Ready, writes: Write[]) {
  return request.post('/api/objects/batch', { headers: headers(account), data: { timeline: account.timeline, writes } });
}

async function put(request: APIRequestContext, account: Account, body: Buffer) {
  const response = await request.put(`/api/files/${hash(body)}`, { headers: { ...headers(account), 'content-type': 'application/octet-stream' }, data: body });
  expect(response.status()).toBe(204);
}

async function leave(request: APIRequestContext, account: Account) {
  const response = await request.delete('/api/account', { headers: headers(account), data: { method: 'password', proof: PROOF } });
  expect(response.status(), (await response.text()).slice(0, 300)).toBe(204);
}

async function prefix(request: APIRequestContext, account: Account) {
  const result = await json<{ keys: string[]; truncated: boolean }>(await request.get('/__store-spec/prefix', { params: { incarnation: account.incarnation } }));
  expect(result.truncated).toBe(false);
  return result.keys;
}

async function heldUpload(request: APIRequestContext, account: Account, body: Buffer) {
  const { token } = await json<{ token: string }>(await request.post('/__store-spec/hold', { data: { key: `files/${account.incarnation}/${hash(body)}` } }));
  const pending = request.put(`/api/files/${hash(body)}`, {
    headers: { ...headers(account), 'content-type': 'application/octet-stream', 'x-store-spec-hold': token }, data: body, timeout: 30_000,
  });
  const release = () => request.post(`/__store-spec/hold/${token}`, { data: {} });
  try {
    await expect.poll(async () => (await json<{ entered: boolean }>(await request.get(`/__store-spec/hold/${token}`))).entered, { timeout: 5000, intervals: [25, 50, 100] }).toBe(true);
  } catch (error) {
    await release();
    await pending;
    throw error;
  }
  return { pending, release };
}

test.beforeAll(async ({ request }) => {
  operator = await json<Actor>(await request.post('/__store-spec/operator', { data: {} }));
  expect(operator.accountId).toBe(STORE_ADMIN);
  expect((await request.put('/api/admin/service', {
    headers: headers(operator), data: { signupCap: 192, accountBytesCap: 300_000_000, accountFileBytesCap: null },
  })).status()).toBe(204);
});

test('signup reads the first usage from a newly initialized store', async ({ request }) => {
  const account = await signup(request);
  expect(account.state).toBe('active');
  expect(account.incarnation).toMatch(/^[0-9a-f]{32}$/);
  expect(account.storage).toEqual({ bytes: 0, bytesCap: 300_000_000, fileBytes: 0, fileBytesCap: null });
  const first = await inspect(request, account);
  expect(first.reads).toBe(1);
  expect(first.tables).toEqual(['head', 'objects']);
  expect(first.head).toEqual({ rev: 0, bytes: 0, timeline: expect.stringMatching(/^[0-9a-f]{32}$/) });
  const usage = await rpc<{ bytes: number; disk: number }>(request, account.incarnation, 'usage');
  expect(usage.bytes).toBe(0);
  expect(usage.disk).toBeGreaterThan(0);
  const page = await json<FeedPage>(await feed(request, account));
  expect(page).toMatchObject({ changes: [], cursor: 0, until: 0, more: false, timeline: first.head!.timeline });
});

test('a 1,500,000-byte body survives the HTTP and store RPC round trip', async ({ request }) => {
  const account = await ready(request);
  const body = 'a'.repeat(1_500_000);
  const item = write(body);
  const response = await batch(request, account, [item]);
  expect(await json(response)).toEqual({ revs: [1], timeline: account.timeline });
  expect(response.headers()['x-account-bytes']).toBe('1500000');
  const page = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  expect(page.changes).toHaveLength(1);
  expect(page.changes[0]).toMatchObject({ id: item.id, rev: 1 });
  expect(Buffer.byteLength(page.changes[0]!.body!)).toBe(1_500_000);
  expect(hash(page.changes[0]!.body!)).toBe(hash(body));
});

test('a Korean feed includes the row crossing four megabytes and continues on the next page', async ({ request }) => {
  const account = await ready(request);
  const body = '한'.repeat(500_000);
  const writes = [write(body), write(body), write(body), write('tail')];
  expect(Buffer.byteLength(body)).toBe(1_500_000);
  for (const item of writes) await json(await batch(request, account, [item]));
  const response = await feed(request, account, { timeline: account.timeline });
  expect(response.headers()['x-account-bytes']).toBe('4500004');
  expect(Buffer.byteLength(await response.body())).toBeGreaterThan(4_000_000);
  const http = await json<FeedPage>(response);
  const direct = await rpc<FeedPage>(request, account.incarnation, 'feed', [account.incarnation, query(account.timeline)]);
  for (const page of [http, direct]) {
    expect(page).toMatchObject({ cursor: 3, until: 4, more: true, timeline: account.timeline });
    expect(page.changes.map(row => row.id)).toEqual(writes.slice(0, 3).map(row => row.id));
    expect(page.changes.map(row => row.rev)).toEqual([1, 2, 3]);
    expect(page.changes.map(row => Buffer.byteLength(row.body!))).toEqual([1_500_000, 1_500_000, 1_500_000]);
    expect(page.changes.map(row => hash(row.body!))).toEqual(Array(3).fill(hash(body)));
  }
  expect(direct.bytes).toBe(4_500_004);
  const nextHttp = await json<FeedPage>(await feed(request, account, { timeline: account.timeline, since: 3, known: 4, until: 4 }));
  const nextRpc = await rpc<FeedPage>(request, account.incarnation, 'feed', [account.incarnation, { ...query(account.timeline), since: 3, known: 4, until: 4 }]);
  for (const next of [nextHttp, nextRpc]) {
    expect(next).toMatchObject({ cursor: 4, until: 4, more: false, timeline: account.timeline });
    expect(next.changes).toEqual([{ id: writes[3]!.id, kind: 'chat', parent: null, rev: 4, body: 'tail' }]);
  }
});

test('a conflict in the last batch item leaves every row and the head unchanged', async ({ request }) => {
  const account = await ready(request);
  const first = write('first');
  const last = write('last');
  await json(await batch(request, account, [first, last]));
  const before = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  const fresh = write('new');
  expect(await json(await batch(request, account, [fresh, { ...first, body: 'changed', baseRev: 1 }, { ...last, baseRev: 1 }]), 409)).toEqual({ error: 'conflict' });
  expect(await json(await feed(request, account, { timeline: account.timeline }))).toEqual(before);
  expect(await inspect(request, account)).toMatchObject({ objects: 2, head: { rev: 2, bytes: 9 } });
  expect(await json(await batch(request, account, [fresh]))).toEqual({ revs: [3], timeline: account.timeline });
});

test('a stale timeline is refused by both the batch and the feed without writing', async ({ request }) => {
  const account = await ready(request);
  const stale = account.timeline === 'f'.repeat(32) ? '0'.repeat(32) : 'f'.repeat(32);
  const item = write('stale');
  expect(await json(await batch(request, { ...account, timeline: stale }, [item]), 409)).toEqual({ error: 'cache-reset' });
  expect(await json(await feed(request, account, { timeline: stale }), 409)).toEqual({ error: 'cache-reset' });
  expect(await rpc(request, account.incarnation, 'batch', [account.incarnation, stale, [item], null])).toEqual({ stale: true });
  expect(await rpc(request, account.incarnation, 'feed', [account.incarnation, query(stale)])).toEqual({ stale: true });
  expect(await inspect(request, account)).toMatchObject({ objects: 0, head: { rev: 0, bytes: 0, timeline: account.timeline } });
  expect(await json(await batch(request, account, [item]))).toEqual({ revs: [1], timeline: account.timeline });
});

test('an account above its lowered cap can still delete an object', async ({ request }) => {
  const account = await ready(request);
  const item = write('a'.repeat(128));
  await json(await batch(request, account, [item]));
  expect((await request.put(`/api/admin/accounts/${account.accountId}/caps`, {
    headers: headers(operator), data: { bytesCap: 64, fileBytesCap: 'default' },
  })).status()).toBe(204);
  expect(await json(await batch(request, account, [write('new')]), 413)).toEqual({ error: 'storage-full' });
  const deleted = await batch(request, account, [{ ...item, body: null, baseRev: 1 }]);
  expect(await json(deleted)).toEqual({ revs: [2], timeline: account.timeline });
  expect(deleted.headers()['x-account-bytes']).toBe('0');
  const page = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  expect(page.changes).toEqual([{ id: item.id, kind: item.kind, parent: null, rev: 2, body: null }]);
  expect(await rpc(request, account.incarnation, 'usage')).toMatchObject({ bytes: 0 });
});

test('leaving invalidates the old cookie and a late batch stores nothing', async ({ request }) => {
  const account = await ready(request);
  await json(await batch(request, account, [write('before leaving')]));
  await leave(request, account);
  expect(await json(await feed(request, account, { timeline: account.timeline }), 401)).toEqual({ error: 'no-session' });
  const late = write('late');
  expect(await json(await batch(request, account, [late]), 401)).toEqual({ error: 'no-session' });
  const refused = await rpc<{ refused: string }>(request, account.incarnation, 'batch', [account.incarnation, account.timeline, [late], null]);
  expect(['leaving', 'gone']).toContain(refused.refused);
  expect(await inspect(request, account)).toMatchObject({ tables: [], objects: 0, head: null });
  expect(await json(await request.get('/api/session', { headers: headers(account) }))).toMatchObject({ session: null });
});

test('leaving removes its R2 picture and preserves another account’s copy of the same content', async ({ request }) => {
  const owner = await ready(request);
  const other = await ready(request);
  const body = Buffer.from('sealed picture shared by two accounts');
  const id = hash(body);
  await put(request, owner, body);
  await put(request, other, body);
  expect(await prefix(request, owner)).toEqual([`files/${owner.incarnation}/${id}`]);
  expect(await prefix(request, other)).toEqual([`files/${other.incarnation}/${id}`]);
  await leave(request, owner);
  expect(await prefix(request, owner)).toEqual([]);
  expect((await request.get('/__store-spec/file', { params: { key: `files/${owner.incarnation}/${id}` } })).status()).toBe(404);
  const kept = await request.get(`/api/files/${id}`, { headers: headers(other) });
  expect(kept.status()).toBe(200);
  expect(await kept.body()).toEqual(body);
  expect(await prefix(request, other)).toEqual([`files/${other.incarnation}/${id}`]);
  expect(await json(await request.get('/api/session', { headers: headers(other) }))).toMatchObject({ session: { storage: { fileBytes: body.length } } });
});

test('the scheduled sweep removes a PUT that finishes after deletion and spares a live prefix', async ({ request }) => {
  const owner = await ready(request);
  const other = await ready(request);
  const body = Buffer.from('sealed picture whose put finishes late');
  const id = hash(body);
  await put(request, other, body);
  const upload = await heldUpload(request, owner, body);
  try {
    expect(await json(await request.get('/api/session', { headers: headers(owner) }))).toMatchObject({ session: { storage: { fileBytes: body.length } } });
    await leave(request, owner);
    expect(await prefix(request, owner)).toEqual([]);
    await upload.release();
    expect(await json(await upload.pending, 401)).toEqual({ error: 'no-session' });
    expect(await prefix(request, owner)).toEqual([`files/${owner.incarnation}/${id}`]);
    expect(await (await request.get('/__store-spec/file', { params: { key: `files/${owner.incarnation}/${id}` } })).body()).toEqual(body);
    expect((await request.get('/cdn-cgi/local/scheduled')).status()).toBe(200);
    await expect.poll(() => prefix(request, owner), { timeout: 5000, intervals: [25, 50, 100] }).toEqual([]);
    const kept = await request.get(`/api/files/${id}`, { headers: headers(other) });
    expect(kept.status()).toBe(200);
    expect(await kept.body()).toEqual(body);
  } finally {
    await upload.release();
    await upload.pending.catch(() => {});
  }
});

test('reusing an account id gets a fresh incarnation with no old objects, usage, or pictures', async ({ request }) => {
  const old = await ready(request);
  const body = Buffer.from('old incarnation picture');
  const lateBody = Buffer.from('old incarnation upload completing after reuse');
  await put(request, old, body);
  await json(await batch(request, old, [write('old object')]));
  const upload = await heldUpload(request, old, lateBody);
  try {
    await leave(request, old);
    const replacement = await ready(request, old.accountId);
    expect(replacement.incarnation).not.toBe(old.incarnation);
    expect(replacement.timeline).not.toBe(old.timeline);
    expect(replacement.storage).toMatchObject({ bytes: 0, fileBytes: 0 });
    await upload.release();
    expect(await json(await upload.pending, 401)).toEqual({ error: 'no-session' });
    expect(await prefix(request, old)).toEqual([`files/${old.incarnation}/${hash(lateBody)}`]);
    expect(await prefix(request, replacement)).toEqual([]);
    const page = await json<FeedPage>(await feed(request, replacement, { timeline: replacement.timeline }));
    expect(page).toMatchObject({ changes: [], cursor: 0, until: 0, more: false });
    expect(await json(await request.get('/api/session', { headers: headers(replacement) }))).toMatchObject({ session: { storage: { bytes: 0, fileBytes: 0 } } });
    const ids = [hash(body), hash(lateBody)];
    expect(await json(await request.post('/api/files/missing', { headers: headers(replacement), data: { ids } }))).toEqual({ missing: ids, maxBytes: 25 * 1024 * 1024 });
    for (const id of ids) expect((await request.get(`/api/files/${id}`, { headers: headers(replacement) })).status()).toBe(404);
    expect(await json(await batch(request, old, [write('late old cookie')]), 401)).toEqual({ error: 'no-session' });
    expect(await json(await batch(request, replacement, [write('new object')]))).toEqual({ revs: [1], timeline: replacement.timeline });
    expect((await request.get('/cdn-cgi/local/scheduled')).status()).toBe(200);
    await expect.poll(() => prefix(request, old), { timeout: 5000, intervals: [25, 50, 100] }).toEqual([]);
  } finally {
    await upload.release();
    await upload.pending.catch(() => {});
  }
});

test('the deletion fence aborts the old instance and a fresh instance reads the lifecycle', async ({ request }) => {
  const account = await ready(request);
  const before = await inspect(request, account);
  await leave(request, account);
  const fenced = await inspect(request, account);
  expect(fenced.instance).not.toBe(before.instance);
  expect(fenced.reads).toBe(1);
  expect(await rpc(request, account.incarnation, 'status')).toEqual({ state: 'leaving', timeline: account.timeline, operation: null });
  await restart(request, account);
  expect(await rpc(request, account.incarnation, 'status')).toEqual({ state: 'gone', timeline: null, operation: null });
  expect((await inspect(request, account)).instance).not.toBe(fenced.instance);
  expect(await rpc(request, account.incarnation, 'usage')).toEqual({ refused: 'gone' });
});

test('deleteAll removes SQL tables and KV keys and a later wake recreates neither', async ({ request }) => {
  const account = await ready(request);
  await json(await batch(request, account, [write('must disappear')]));
  await rpc(request, account.incarnation, 'seedKey', []);
  expect(await inspect(request, account)).toMatchObject({ tables: ['head', 'objects'], objects: 1, keys: ['store-spec-marker'] });
  await leave(request, account);
  expect(await inspect(request, account)).toMatchObject({ tables: [], objects: 0, keys: [], head: null });
  expect(await rpc(request, account.incarnation, 'destroy')).toEqual({ destroyed: true });
  await restart(request, account);
  expect(await rpc(request, account.incarnation, 'feed', [account.incarnation, query(account.timeline)])).toEqual({ refused: 'gone' });
  expect(await inspect(request, account)).toMatchObject({ tables: [], objects: 0, keys: [], head: null });
});

test('concurrent calls during a store wake share one lifecycle load and commit distinct revisions', async ({ request }) => {
  const account = await ready(request);
  await restart(request, account);
  await rpc(request, account.incarnation, 'delayWake', []);
  const writes = Array.from({ length: 8 }, (_, index) => write(`wake-${index}`));
  const answers = await Promise.all(writes.map(item => rpc<{ revs: number[]; timeline: string }>(request, account.incarnation, 'batch', [account.incarnation, account.timeline, [item], null])));
  expect(answers.map(answer => answer.revs).flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(answers.map(answer => answer.timeline)).toEqual(Array(8).fill(account.timeline));
  const page = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  expect(page.changes.map(row => row.id).sort()).toEqual(writes.map(item => item.id).sort());
  expect(await inspect(request, account)).toMatchObject({ reads: 1, delay: 200, objects: 8, head: { rev: 8, bytes: 48, timeline: account.timeline } });
});

test('an acknowledged batch is still readable after a real abort and restart', async ({ request }) => {
  const account = await ready(request);
  const item = write('committed before abort');
  await json(await batch(request, account, [item]));
  const before = await inspect(request, account);
  await restart(request, account);
  const page = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  expect(page.changes).toEqual([{ id: item.id, kind: item.kind, parent: null, rev: 1, body: item.body }]);
  const after = await inspect(request, account);
  expect(after.instance).not.toBe(before.instance);
  expect(after.head).toEqual(before.head);
});

test('the operator reads bounded account pages and separately refreshes usage totals', async ({ request }) => {
  const listing = async () => {
    let next: string | null = null;
    const accounts: Listing['accounts'] = [];
    do {
      const page: Listing = await json<Listing>(await request.get(`/api/admin/accounts${next === null ? '' : `?after=${encodeURIComponent(next)}`}`, { headers: headers(operator) }));
      expect(page.accounts.length).toBeLessThanOrEqual(100);
      accounts.push(...page.accounts);
      next = page.next;
    } while (next !== null);
    return accounts;
  };
  const usage = async () => {
    let next: string | null = null;
    const sum = { bytes: 0, disk: 0, unread: 0, readAt: 0 };
    do {
      const page: UsagePage = await json<UsagePage>(await request.get(`/api/admin/usage${next === null ? '' : `?after=${encodeURIComponent(next)}`}`, { headers: headers(operator) }));
      expect(page.accounts).toBeLessThanOrEqual(100);
      sum.bytes += page.totals.bytes;
      sum.disk += page.totals.disk;
      sum.unread += page.totals.unread;
      sum.readAt = page.totals.readAt;
      next = page.next;
    } while (next !== null);
    return sum;
  };
  const before = await listing();
  const beforeUsage = await usage();
  const added: { account: Ready; bytes: number }[] = [];
  for (let group = 0; group < 26; group++) {
    const accounts = await Promise.all(Array.from({ length: 4 }, () => ready(request)));
    for (const account of accounts) {
      const body = `fan-out-${added.length}-한`;
      await json(await batch(request, account, [write(body)]));
      added.push({ account, bytes: Buffer.byteLength(body) });
    }
  }
  const started = Date.now();
  const after = await listing();
  const afterUsage = await usage();
  expect(after).toHaveLength(before.length + 104);
  expect(afterUsage.unread).toBe(0);
  expect(afterUsage.readAt).toBeGreaterThanOrEqual(started);
  expect(afterUsage.readAt).toBeLessThanOrEqual(Date.now());
  for (const { account, bytes } of added) {
    const row = after.find(row => row.accountId === account.accountId);
    expect(row).toMatchObject({ state: 'active', bytes, fileBytes: 0 });
    expect(row!.disk).toBeGreaterThan(0);
  }
  expect(afterUsage.bytes).toBe(beforeUsage.bytes + added.reduce((sum, row) => sum + row.bytes, 0));
  expect(afterUsage.disk).toBe(after.reduce((sum, row) => sum + row.disk!, 0));
});
