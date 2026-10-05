import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SqlValue, Statement } from './db/service-db';
import { fileBlocks } from './files';
import type { Bucket } from './files/disk-bucket';
import { hex, type AppEnv } from './http';
import { proof, sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const idOf = async (bytes: Uint8Array<ArrayBuffer>) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
const signup = async (body = signupBody()) => {
  await t.env.db.prepare('UPDATE service SET signup_cap = signup_cap + 1').run();
  const cookie = sessionCookie(await t.post('signup', body));
  const incarnation = (await t.env.db.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(body.accountId).first<string>('incarnation'))!;
  return { id: body.accountId, cookie, incarnation };
};
const put = (id: string, bytes: Uint8Array<ArrayBuffer>, cookie?: string) => t.put(`files/${id}`, bytes, cookie);
const missing = async (ids: string[], cookie: string) => ((await (await t.post('files/missing', { ids }, cookie)).json()) as { missing: string[] }).missing;
const rows = (incarnation: string) => t.env.db.prepare('SELECT size, stored FROM account_files WHERE incarnation = ?').bind(incarnation).all().then(({ results }) => results);
const sum = (incarnation: string) => t.env.db.prepare('SELECT file_bytes AS sum FROM accounts WHERE incarnation = ?').bind(incarnation).first<number>('sum');
const stored = async (incarnation: string, id: string) => {
  const body = await t.env.files.get(`files/${incarnation}/${id}`);
  return body ? new Response(body).arrayBuffer() : undefined;
};
// Past the hour in which the hourly job spares a prefix with no account: an upload may still be landing in it.
const later = () => Date.now() + 2 * 3_600_000;
const operator = new Hono<AppEnv>().route('/', fileBlocks);
const block = (id: string, blocked: boolean) =>
  operator.request(`/files/${id}/blocked`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blocked }) }, t.env);

async function withFilesPut(put: Bucket['put'], step: () => Promise<void>) {
  const files = t.env.files;
  t.env.files = { ...files, put };
  try {
    await step();
  } finally {
    t.env.files = files;
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

    expect((await t.delete('account', { method: 'password', proof: proof('password') }, other.cookie)).status).toBe(204);
    await t.settle();
    expect(await stored(other.incarnation, id)).toBeUndefined();
    expect(new Uint8Array(await (await t.get(`files/${id}`, jin.cookie)).arrayBuffer())).toEqual(bytes);
  });

  it('looks up requested file IDs by the account composite key rather than materializing its inventory', async () => {
    const { cookie } = await signup();
    const db = t.env.db;
    const plans: { detail: string }[] = [];
    t.env.db = new Proxy(db, {
      get: (target, key) => key === 'prepare' ? (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes('json_each(?2)')) return statement;
        return Object.assign(Object.create(statement) as Statement, {
          bind: (...values: SqlValue[]) => {
            const bound = statement.bind(...values);
            return Object.assign(Object.create(bound) as Statement, {
              all: async () => {
                plans.push(...(await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all<{ detail: string }>()).results);
                return bound.all();
              },
            });
          },
        });
      } : (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target),
    });
    try {
      const id = '0'.repeat(64);
      expect(await missing([id], cookie)).toEqual([id]);
      expect(plans.some(({ detail }) => detail.includes('incarnation=? AND id=?'))).toBe(true);
      expect(plans.some(({ detail }) => detail.includes('LIST SUBQUERY'))).toBe(false);
    } finally {
      t.env.db = db;
    }
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
    const files = t.env.files;
    await withFilesPut(
      () => Promise.reject(new Error('cut before the bytes')),
      async () => expect((await put(earlyId, early, jin.cookie)).status).toBe(500),
    );
    await withFilesPut(
      async (key, value) => {
        await files.put(key, value);
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
    await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 5').run();
    const jin = await signup();
    const [kept, large] = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    expect((await put(await idOf(kept), kept, jin.cookie)).status).toBe(204);

    const refused = await put(await idOf(large), large, jin.cookie);
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({ error: 'files-full' });
    expect(await stored(jin.incarnation, await idOf(large))).toBeUndefined();
    expect(await sum(jin.incarnation)).toBe(3);

    await t.env.db.prepare('UPDATE accounts SET own_file_bytes_cap = 1, file_bytes_cap = 6 WHERE id = ?').bind(jin.id).run();
    expect((await put(await idOf(large), large, jin.cookie)).headers.get('x-account-file-bytes')).toBe('6');
  });

  it('charges only one concurrent reservation near the cap and retries it after a cap reduction', async () => {
    const { cookie, incarnation } = await signup();
    await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 3').run();
    const bodies = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    const ids = await Promise.all(bodies.map(idOf));
    const replies = await Promise.all(bodies.map((body, index) => put(ids[index]!, body, cookie)));
    expect(replies.map(({ status }) => status).sort()).toEqual([204, 413]);
    expect(await sum(incarnation)).toBe(3);
    expect(await rows(incarnation)).toEqual([{ size: 3, stored: 1 }]);

    const kept = replies.findIndex(({ status }) => status === 204);
    await t.env.db.prepare('UPDATE account_files SET stored = 0 WHERE incarnation = ?').bind(incarnation).run();
    await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 0').run();
    const retried = await Promise.all([put(ids[kept]!, bodies[kept]!, cookie), put(ids[kept]!, bodies[kept]!, cookie)]);
    expect(retried.map(({ status }) => status)).toEqual([204, 204]);
    expect(await sum(incarnation)).toBe(3);
    await t.env.db.prepare('DELETE FROM accounts WHERE incarnation = ?').bind(incarnation).run();
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
    expect((await t.env.db.prepare('SELECT action, target FROM admin_log ORDER BY id').all()).results).toEqual([
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
    const files = t.env.files;
    let reused!: Awaited<ReturnType<typeof signup>>;
    await withFilesPut(
      async (key, value) => {
        await t.env.db.prepare('DELETE FROM accounts WHERE id = ?').bind(old.id).run();
        reused = await signup(body);
        return files.put(key, value);
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

    await t.reconcile(later());
    expect(await stored(old.incarnation, id)).toBeUndefined();
  });

  it('sweeps a prefix with no account once it is an hour old, and spares a younger one and a live one', async () => {
    const [live, gone] = [await signup(), await signup(signupBody('gone'))];
    const bytes = new Uint8Array([5]);
    const id = await idOf(bytes);
    for (const { cookie } of [live, gone]) await put(id, bytes, cookie);
    await t.env.db.prepare('DELETE FROM accounts WHERE id = ?').bind(gone.id).run();
    expect(await rows(gone.incarnation)).toEqual([]);

    await t.reconcile();
    expect(await stored(gone.incarnation, id)).toBeDefined();
    await t.reconcile(later());
    expect(await stored(gone.incarnation, id)).toBeUndefined();
    expect(await stored(live.incarnation, id)).toBeDefined();
  });
});
