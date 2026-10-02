import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hex } from './http';
import { readAll } from './admin';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  await t.env.DB.prepare('UPDATE service SET signup_cap = 3').run();
});

async function account(username: string) {
  const body = signupBody(username);
  return { id: body.accountId, cookie: sessionCookie(await t.post('signup', body)) };
}

async function operator() {
  const admin = await account('operator');
  t.env.ADMIN_ACCOUNT = admin.id;
  return admin;
}

const log = async (cookie: string) => ((await (await t.get('admin/log', cookie)).json()) as { log: { action: string; target: string; detail: unknown }[] }).log;

async function stored(bytes: Uint8Array<ArrayBuffer>, cookie: string) {
  const id = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  await t.put(`files/${id}`, bytes, cookie);
  return id;
}

describe('the operator', () => {
  it('is the one account the Worker names: the session says so, nobody else passes, and nobody signs up as it', async () => {
    const admin = await operator();
    const other = await account('other');
    expect(await (await t.get('session', admin.cookie)).json()).toMatchObject({ session: { admin: true } });
    expect(await (await t.get('session', other.cookie)).json()).toMatchObject({ session: { admin: false } });

    const refused = await t.get('admin/accounts', other.cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'not-admin' });

    await t.delete(`admin/accounts/${admin.id}`, undefined, admin.cookie);
    expect((await t.post('signup', { ...signupBody('again'), accountId: admin.id })).status).toBe(400);
  });

  it("lists each account with its store's bytes, its pictures and its own caps, and totals what the stores answered", async () => {
    const admin = await operator();
    const other = await account('other');
    const leaving = await account('leaving');
    const file = await stored(new Uint8Array([1, 2, 3]), other.cookie);
    const writes = ['a', 'b'].map((body) => ({ id: crypto.randomUUID(), kind: 'asset', parent: null, body: body.repeat(10), baseRev: null, file }));
    await t.batch(writes, other.cookie);
    await t.batch(writes.map((write) => ({ ...write, id: crypto.randomUUID() })), admin.cookie);
    await t.lifecycle(leaving.id, "state = 'leaving'");

    const answer = (await (await t.get('admin/accounts', admin.cookie)).json()) as { accounts: Record<string, unknown>[]; totals: Record<string, unknown> };
    const row = { createdAt: expect.any(Number), suspended: false, state: 'active', disk: expect.any(Number), bytesCap: 'default', fileBytesCap: 'default' };
    expect(answer.accounts).toEqual([
      { ...row, accountId: admin.id, username: 'operator', bytes: 20, fileBytes: 0 },
      { ...row, accountId: other.id, username: 'other', bytes: 20, fileBytes: 3 },
      { ...row, accountId: leaving.id, username: 'leaving', state: 'leaving', bytes: null, disk: null, fileBytes: 0 },
    ]);
    expect(answer.totals).toEqual({ bytes: 40, disk: expect.any(Number), unread: 1, readAt: expect.any(Number) });
  });

  it('keeps at most fifty store reads in flight and answers the ones unsettled at the deadline as unread', async () => {
    let flying = 0;
    let most = 0;
    let started = 0;
    const releases: (() => void)[] = [];
    const calls = Array.from({ length: 120 }, (_, index) => async () => {
      started++;
      flying++;
      most = Math.max(most, flying);
      // Every other store is slow: it answers only after the deadline.
      if (index % 2 === 0) await new Promise<void>((resolve) => releases.push(resolve));
      flying--;
      return index;
    });
    const read = await readAll(calls, 50, 100);
    const answered = read.filter((answer) => answer !== undefined);
    expect(most).toBe(50);
    expect(answered.length).toBe(started - 50);
    expect(read.every((answer, index) => answer === undefined || answer === index)).toBe(true);
    const startedByDeadline = started;
    for (const release of releases) release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect([started, read.filter((answer) => answer !== undefined).length]).toEqual([startedByDeadline, answered.length]);
  });

  it('suspends an account, lifts it and deletes the account, logging each with the username', async () => {
    const admin = await operator();
    const other = await account('other');
    const timeline = await t.timeline(other.cookie);
    const write = () => t.post('objects/batch', { timeline, writes: [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }] }, other.cookie);

    expect((await t.put(`admin/accounts/${other.id}/suspended`, { suspended: true }, admin.cookie)).status).toBe(204);
    expect((await write()).status).toBe(403);
    expect((await t.put(`admin/accounts/${other.id}/suspended`, { suspended: false }, admin.cookie)).status).toBe(204);
    expect((await write()).status).toBe(200);
    expect((await t.delete(`admin/accounts/${other.id}`, undefined, admin.cookie)).status).toBe(204);
    expect((await write()).status).toBe(401);
    expect((await t.delete(`admin/accounts/${other.id}`, undefined, admin.cookie)).status).toBe(404);

    expect(await log(admin.cookie)).toMatchObject(
      ['delete-account', 'lift', 'suspend'].map((action) => ({ action, target: other.id, detail: { username: 'other' } })),
    );
  });

  it('reads the service values with their totals and sets them, which opens signup again', async () => {
    const admin = await operator();
    await stored(new Uint8Array([1, 2, 3]), admin.cookie);
    expect(await (await t.get('admin/service', admin.cookie)).json()).toEqual({ signupCap: 3, accountBytesCap: null, accountFileBytesCap: null, accounts: 1, fileBytes: 3 });

    expect((await t.put('admin/service', { signupCap: 1, accountBytesCap: 1000, accountFileBytesCap: 2000 }, admin.cookie)).status).toBe(204);
    expect((await t.post('signup', signupBody('late'))).status).toBe(403);
    expect((await t.put('admin/service', { signupCap: 2, accountBytesCap: null, accountFileBytesCap: null }, admin.cookie)).status).toBe(204);
    expect((await t.post('signup', signupBody('late'))).status).toBe(201);
    expect((await log(admin.cookie))[0]).toMatchObject({ action: 'set-service', target: 'service', detail: { signupCap: 2, accountBytesCap: null, accountFileBytesCap: null } });
  });

  it("gives an account its own caps in place of the service's, none among them, and logs each", async () => {
    const admin = await operator();
    const other = await account('other');
    await t.env.DB.prepare('UPDATE service SET account_bytes_cap = 0, account_file_bytes_cap = 0').run();
    const write = async () => (await t.batch([{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }], other.cookie)).status;
    const session = async () => ((await (await t.get('session', other.cookie)).json()) as { session: { storage: unknown } }).session.storage;
    expect(await write()).toBe(413);

    expect((await t.put(`admin/accounts/${other.id}/caps`, { bytesCap: null, fileBytesCap: 5 }, admin.cookie)).status).toBe(204);
    expect(await write()).toBe(200);
    expect(await session()).toEqual({ bytes: 6, bytesCap: null, fileBytes: 0, fileBytesCap: 5 });

    expect((await t.put(`admin/accounts/${other.id}/caps`, { bytesCap: 'default', fileBytesCap: 'default' }, admin.cookie)).status).toBe(204);
    expect(await write()).toBe(413);
    expect(await session()).toEqual({ bytes: 6, bytesCap: 0, fileBytes: 0, fileBytesCap: 0 });
    expect((await t.put(`admin/accounts/${other.id}/caps`, { bytesCap: -1, fileBytesCap: 'default' }, admin.cookie)).status).toBe(400);
    expect(await log(admin.cookie)).toMatchObject([
      { action: 'set-caps', target: other.id, detail: { username: 'other', bytesCap: 'default', fileBytesCap: 'default' } },
      { action: 'set-caps', target: other.id, detail: { username: 'other', bytesCap: null, fileBytesCap: 5 } },
    ]);
  });

  it('lists the reports accounts send, a suspended one too, and resolves one once', async () => {
    const admin = await operator();
    const other = await account('other');
    await t.env.DB.prepare('UPDATE accounts SET suspended_at = 1 WHERE id = ?').bind(other.id).run();
    expect((await t.post('reports', { text: '  이 봇이 이상해요  ' }, other.cookie)).status).toBe(204);
    expect((await t.post('reports', { text: 'x'.repeat(4001) }, other.cookie)).status).toBe(400);

    const { reports } = (await (await t.get('admin/reports', admin.cookie)).json()) as { reports: { id: number }[] };
    expect(reports).toEqual([{ id: expect.any(Number), accountId: other.id, username: 'other', text: '이 봇이 이상해요', createdAt: expect.any(Number), resolvedAt: null }]);

    const { id } = reports[0]!;
    expect((await t.post(`admin/reports/${id}/resolve`, undefined, admin.cookie)).status).toBe(204);
    expect((await t.post(`admin/reports/${id}/resolve`, undefined, admin.cookie)).status).toBe(404);
    expect(await (await t.get('admin/reports', admin.cookie)).json()).toMatchObject({ reports: [{ id, resolvedAt: expect.any(Number) }] });
    expect(await log(admin.cookie)).toMatchObject([{ action: 'resolve-report', target: String(id), detail: null }]);
  });

  it('refuses an account another report while it has twenty unresolved', async () => {
    const other = await account('other');
    const sent = await Promise.all(Array.from({ length: 21 }, () => t.post('reports', { text: 'again' }, other.cookie)));
    expect(sent.map(({ status }) => status).sort()).toEqual([...Array<number>(20).fill(204), 429]);
  });

  it('blocks a stored file for every account: no read, no upload, and an import is told the server does not hold it', async () => {
    const admin = await operator();
    const other = await account('other');
    const bytes = new Uint8Array([4, 5, 6]);
    const id = await stored(bytes, other.cookie);
    const put = () => t.put(`files/${id}`, bytes, other.cookie);
    const missing = async () => ((await (await t.post('files/missing', { ids: [id] }, other.cookie)).json()) as { missing: string[] }).missing;

    expect((await t.put(`admin/files/${id}/blocked`, { blocked: true }, admin.cookie)).status).toBe(204);
    for (const response of [await t.get(`files/${id}`, other.cookie), await put()]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'file-blocked' });
    }
    expect(await missing()).toEqual([id]);

    expect((await t.put(`admin/files/${id}/blocked`, { blocked: false }, admin.cookie)).status).toBe(204);
    expect(new Uint8Array(await (await t.get(`files/${id}`, other.cookie)).arrayBuffer())).toEqual(bytes);
    expect(await missing()).toEqual([]);
    // A block needs no holder.
    const nobody = '0'.repeat(64);
    expect((await t.put(`admin/files/${nobody}/blocked`, { blocked: true }, admin.cookie)).status).toBe(204);
    expect(await log(admin.cookie)).toMatchObject([{ action: 'block-file', target: nobody }, { action: 'unblock-file', target: id }, { action: 'block-file', target: id }]);
  });
});
