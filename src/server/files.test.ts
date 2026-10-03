import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileBlocks, removeAccountFiles, sweepDeadPrefixes } from './files';
import { hex, type AppEnv } from './http';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

// The platform's env types ADMIN_ACCOUNT as any string, since tests name an operator; Env has the configured literal.
const env = () => t.env as Env;
const idOf = async (bytes: Uint8Array<ArrayBuffer>) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
const signup = async (body = signupBody()) => {
  await t.env.DB.prepare('UPDATE service SET signup_cap = signup_cap + 1').run();
  const cookie = sessionCookie(await t.post('signup', body));
  const incarnation = (await t.env.DB.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(body.accountId).first<string>('incarnation'))!;
  return { id: body.accountId, cookie, incarnation };
};
const put = (id: string, bytes: Uint8Array<ArrayBuffer>, cookie?: string) => t.put(`files/${id}`, bytes, cookie);
const missing = async (ids: string[], cookie: string) => ((await (await t.post('files/missing', { ids }, cookie)).json()) as { missing: string[] }).missing;
const rows = (incarnation: string) => t.env.DB.prepare('SELECT size, stored FROM account_files WHERE incarnation = ?').bind(incarnation).all().then(({ results }) => results);
const sum = (incarnation: string) => t.env.DB.prepare('SELECT file_bytes AS sum FROM accounts WHERE incarnation = ?').bind(incarnation).first<number>('sum');
const stored = async (incarnation: string, id: string) => (await t.env.BLOBS.get(`files/${incarnation}/${id}`))?.arrayBuffer();
const operator = new Hono<AppEnv>().route('/', fileBlocks);
const block = (id: string, blocked: boolean) =>
  operator.request(`/files/${id}/blocked`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blocked }) }, t.env);

// Replaces one method of a binding for the length of a test step, as a crash at that point would.
async function withBlobsPut(put: (key: string, value: Parameters<R2Bucket['put']>[1]) => Promise<unknown>, step: () => Promise<void>) {
  const blobs = t.env.BLOBS;
  t.env.BLOBS = Object.assign(Object.create(blobs) as R2Bucket, { put });
  try {
    await step();
  } finally {
    t.env.BLOBS = blobs;
  }
}

describe('files', () => {
  it('keeps a separate copy and sum per account for the same content, and says which ids the asker lacks', async () => {
    const [jin, other] = [await signup(), await signup(signupBody('other'))];
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const id = await idOf(bytes);
    const absent = await idOf(new Uint8Array([9]));

    const first = await put(id, bytes, jin.cookie);
    expect(first.headers.get('x-account-file-bytes')).toBe('4');
    expect((await put(id, bytes, jin.cookie)).status).toBe(204);
    expect(await missing([id, absent], jin.cookie)).toEqual([absent]);
    expect(await missing([id, absent], other.cookie)).toEqual([id, absent]);
    expect((await t.get(`files/${id}`, other.cookie)).status).toBe(404);

    expect((await put(id, bytes, other.cookie)).headers.get('x-account-file-bytes')).toBe('4');
    expect([await sum(jin.incarnation), await sum(other.incarnation)]).toEqual([4, 4]);
    expect(new Uint8Array((await stored(other.incarnation, id))!)).toEqual(bytes);
    const read = await t.get(`files/${id}`, jin.cookie);
    expect(read.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
    expect((await t.get(`files/${absent}`, jin.cookie)).status).toBe(404);

    await removeAccountFiles(env(), jin.incarnation);
    await removeAccountFiles(env(), jin.incarnation);
    expect(await stored(jin.incarnation, id)).toBeUndefined();
    expect(new Uint8Array(await (await t.get(`files/${id}`, other.cookie)).arrayBuffer())).toEqual(bytes);
  });

  it('refuses a body that is not its id, a bad id, an oversized body and a missing session', async () => {
    const { cookie } = await signup();
    const id = await idOf(new Uint8Array([1]));
    expect((await put(id, new Uint8Array([2]), cookie)).status).toBe(400);
    expect((await put('not-a-hash', new Uint8Array([1]), cookie)).status).toBe(400);
    expect((await put(id, new Uint8Array(25 * 1024 * 1024 + 1), cookie)).status).toBe(413);
    expect((await t.post('files/missing', { ids: ['x'] }, cookie)).status).toBe(400);
    expect((await put(id, new Uint8Array([1]))).status).toBe(401);
    expect((await t.get(`files/${id}`)).status).toBe(401);
  });

  it('finishes an upload cut after its reservation or after its bytes with one row and one charge', async () => {
    const jin = await signup();
    const [early, late] = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7])];
    const [earlyId, lateId] = [await idOf(early), await idOf(late)];
    const blobs = t.env.BLOBS;
    await withBlobsPut(
      () => Promise.reject(new Error('cut before the bytes')),
      async () => expect((await put(earlyId, early, jin.cookie)).status).toBe(500),
    );
    await withBlobsPut(
      async (key, value) => {
        await blobs.put(key, value);
        throw new Error('cut before the finalize');
      },
      async () => expect((await put(lateId, late, jin.cookie)).status).toBe(500),
    );
    expect(await rows(jin.incarnation)).toEqual([
      { size: 3, stored: 0 },
      { size: 4, stored: 0 },
    ]);
    expect(await missing([earlyId, lateId], jin.cookie)).toEqual([earlyId, lateId]);
    expect((await t.get(`files/${lateId}`, jin.cookie)).status).toBe(404);

    expect((await put(earlyId, early, jin.cookie)).headers.get('x-account-file-bytes')).toBe('7');
    expect((await put(lateId, late, jin.cookie)).headers.get('x-account-file-bytes')).toBe('7');
    expect(await rows(jin.incarnation)).toEqual([
      { size: 3, stored: 1 },
      { size: 4, stored: 1 },
    ]);
    expect(await missing([earlyId, lateId], jin.cookie)).toEqual([]);
  });

  it('refuses a file past the cap at its reservation, storing nothing, under the account’s own cap when it has one', async () => {
    await t.env.DB.prepare('UPDATE service SET account_file_bytes_cap = 5').run();
    const jin = await signup();
    const [kept, large] = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    expect((await put(await idOf(kept), kept, jin.cookie)).status).toBe(204);

    const refused = await put(await idOf(large), large, jin.cookie);
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({ error: 'files-full' });
    expect(await stored(jin.incarnation, await idOf(large))).toBeUndefined();
    expect(await sum(jin.incarnation)).toBe(3);

    await t.env.DB.prepare('UPDATE accounts SET own_file_bytes_cap = 1, file_bytes_cap = 6 WHERE id = ?').bind(jin.id).run();
    expect((await put(await idOf(large), large, jin.cookie)).headers.get('x-account-file-bytes')).toBe('6');
  });

  it('charges only one concurrent reservation near the cap and retries it after a cap reduction', async () => {
    const { cookie, incarnation } = await signup();
    await t.env.DB.prepare('UPDATE service SET account_file_bytes_cap = 3').run();
    const bodies = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    const ids = await Promise.all(bodies.map(idOf));
    const replies = await Promise.all(bodies.map((body, index) => put(ids[index]!, body, cookie)));
    expect(replies.map(({ status }) => status).sort()).toEqual([204, 413]);
    expect(await sum(incarnation)).toBe(3);
    expect(await rows(incarnation)).toEqual([{ size: 3, stored: 1 }]);

    const kept = replies.findIndex(({ status }) => status === 204);
    await t.env.DB.prepare('UPDATE account_files SET stored = 0 WHERE incarnation = ?').bind(incarnation).run();
    await t.env.DB.prepare('UPDATE service SET account_file_bytes_cap = 0').run();
    const retried = await Promise.all([put(ids[kept]!, bodies[kept]!, cookie), put(ids[kept]!, bodies[kept]!, cookie)]);
    expect(retried.map(({ status }) => status)).toEqual([204, 204]);
    expect(await sum(incarnation)).toBe(3);
    await t.env.DB.prepare('DELETE FROM accounts WHERE incarnation = ?').bind(incarnation).run();
    expect(await rows(incarnation)).toEqual([]);
    expect(await sum(incarnation)).toBeNull();
  });

  it('refuses blocked content to every account that holds it, and brings every copy back when lifted', async () => {
    const [jin, other] = [await signup(), await signup(signupBody('other'))];
    const bytes = new Uint8Array([7, 7]);
    const id = await idOf(bytes);
    for (const { cookie } of [jin, other]) await put(id, bytes, cookie);

    expect((await block(id, true)).status).toBe(204);
    expect((await block(id, true)).status).toBe(204);
    for (const { cookie } of [jin, other]) {
      for (const response of [await t.get(`files/${id}`, cookie), await put(id, bytes, cookie)]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'file-blocked' });
      }
      expect(await missing([id], cookie)).toEqual([id]);
    }

    expect((await block(id, false)).status).toBe(204);
    for (const { cookie } of [jin, other]) expect(new Uint8Array(await (await t.get(`files/${id}`, cookie)).arrayBuffer())).toEqual(bytes);
    expect((await block('0'.repeat(64), true)).status).toBe(204);
    expect((await t.env.DB.prepare('SELECT action, target FROM admin_log ORDER BY id').all()).results).toEqual([
      { action: 'block-file', target: id },
      { action: 'unblock-file', target: id },
      { action: 'block-file', target: '0'.repeat(64) },
    ]);
  });

  it('serves a signup that reuses a client id nothing of an old upload finishing late', async () => {
    const body = signupBody();
    const old = await signup(body);
    const bytes = new Uint8Array([3, 1, 4]);
    const id = await idOf(bytes);
    const blobs = t.env.BLOBS;
    let reused!: Awaited<ReturnType<typeof signup>>;
    await withBlobsPut(
      async (key, value) => {
        await t.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(old.id).run();
        reused = await signup(body);
        return blobs.put(key, value);
      },
      async () => expect((await put(id, bytes, old.cookie)).status).toBe(401),
    );
    expect(reused.incarnation).not.toBe(old.incarnation);
    expect(await rows(old.incarnation)).toEqual([]);
    expect(await stored(old.incarnation, id)).toBeDefined();

    expect(await rows(reused.incarnation)).toEqual([]);
    expect(await sum(reused.incarnation)).toBe(0);
    expect(await missing([id], reused.cookie)).toEqual([id]);
    expect((await t.get(`files/${id}`, reused.cookie)).status).toBe(404);

    await sweepDeadPrefixes(env());
    expect(await stored(old.incarnation, id)).toBeUndefined();
  });

  it('sweeps a prefix with no account and spares a live one, even one whose account came after the accounts read', async () => {
    const [live, gone] = [await signup(), await signup(signupBody('gone'))];
    const bytes = new Uint8Array([5]);
    const id = await idOf(bytes);
    for (const { cookie } of [live, gone]) await put(id, bytes, cookie);
    await t.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(gone.id).run();
    expect(await rows(gone.incarnation)).toEqual([]);

    // An account and its upload landing between the sweep's two reads: a D1-first sweep would list it as dead.
    const db = t.env.DB;
    let late!: Awaited<ReturnType<typeof signup>>;
    t.env.DB = new Proxy(db, {
      get: (target, key) =>
        key === 'prepare'
          ? (sql: string) => {
              const statement = target.prepare(sql);
              if (sql !== 'SELECT incarnation FROM accounts') return statement;
              return Object.assign(Object.create(statement) as D1PreparedStatement, {
                all: async () => {
                  const read = await statement.all();
                  t.env.DB = db;
                  late = await signup(signupBody('late'));
                  await put(id, bytes, late.cookie);
                  return read;
                },
              });
            }
          : (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target),
    });
    try {
      await sweepDeadPrefixes(env());
    } finally {
      t.env.DB = db;
    }
    expect(await stored(gone.incarnation, id)).toBeUndefined();
    expect(await stored(live.incarnation, id)).toBeDefined();
    expect(await stored(late.incarnation, id)).toBeDefined();
  });
});
