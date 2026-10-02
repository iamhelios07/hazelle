import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hex } from './http';
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
  await t.raw(`files/${id}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', cookie }, body: bytes });
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

  it('lists each account with the bytes of its bodies and of the files its objects name', async () => {
    const admin = await operator();
    const other = await account('other');
    const file = await stored(new Uint8Array([1, 2, 3]), other.cookie);
    const writes = ['a', 'b'].map((body) => ({ id: crypto.randomUUID(), kind: 'asset', parent: null, body: body.repeat(10), baseRev: null, file }));
    await t.post('objects/batch', { writes }, other.cookie);

    const { accounts } = (await (await t.get('admin/accounts', admin.cookie)).json()) as { accounts: Record<string, unknown>[] };
    expect(accounts).toEqual([
      { accountId: admin.id, username: 'operator', createdAt: expect.any(Number), suspended: false, bytes: 0, fileBytes: 0 },
      { accountId: other.id, username: 'other', createdAt: expect.any(Number), suspended: false, bytes: 20, fileBytes: 3 },
    ]);
  });

  it('suspends an account, lifts it and deletes the account, logging each with the username', async () => {
    const admin = await operator();
    const other = await account('other');
    const write = () => t.post('objects/batch', { writes: [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }] }, other.cookie);

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
    await t.post('objects/batch', { writes: [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }] }, admin.cookie);
    expect(await (await t.get('admin/service', admin.cookie)).json()).toEqual({ signupCap: 3, accountBytesCap: null, accounts: 1, bytes: 6 });

    expect((await t.put('admin/service', { signupCap: 1, accountBytesCap: 1000 }, admin.cookie)).status).toBe(204);
    expect((await t.post('signup', signupBody('late'))).status).toBe(403);
    expect((await t.put('admin/service', { signupCap: 2, accountBytesCap: null }, admin.cookie)).status).toBe(204);
    expect((await t.post('signup', signupBody('late'))).status).toBe(201);
    expect((await log(admin.cookie))[0]).toMatchObject({ action: 'set-service', target: 'service', detail: { signupCap: 2, accountBytesCap: null } });
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
    const put = () => t.raw(`files/${id}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', cookie: other.cookie }, body: bytes });
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
    expect((await t.put(`admin/files/${'0'.repeat(64)}/blocked`, { blocked: true }, admin.cookie)).status).toBe(404);
    expect(await log(admin.cookie)).toMatchObject([{ action: 'unblock-file', target: id }, { action: 'block-file', target: id }]);
  });
});
