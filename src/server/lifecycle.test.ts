import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FeedPage, Phase, Write } from './account-store';
import { hex } from './http';
import { beginRestore, cancelRestore, leaveAccount, runRestore } from './lifecycle';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(fresh);

async function fresh() {
  await t.reset();
  await t.env.DB.prepare('UPDATE service SET signup_cap = 1000').run();
}

const HOUR_MS = 3_600_000;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const BEFORE: Record<string, string> = { [A]: 'new', [B]: 'b' };
const AT_TARGET: Record<string, string> = { [A]: 'old' };
const BEFORE_ARMED: Phase[] = ['begun', 'fenced', 'checkpointed', 'targeted'];

class Crash extends Error {}

// The test platform's env, whose operator var is writable.
const env = () => t.env as Env;

// env with every durable boundary passing through hook once it is over: a D1 write committed, a store call answered
// (restart included), an R2 delete done. A hook that throws is a crash right after that boundary; one that waits
// pauses the runner there. Once a hook has thrown, the runner is dead: every later call throws before it does
// anything, since the code swallows the failure of a restart by design. arms: the target of every arm call that
// reached the store. checkpoints: rows each checkpoint write changed.
function watched(hook: (what: string) => void | Promise<void>) {
  const arms: string[] = [];
  let checkpoints = 0;
  let dead: unknown = null;
  const alive = () => {
    if (dead) throw dead;
  };
  const boundary = async (what: string) => {
    try {
      await hook(what);
    } catch (error) {
      dead = error;
      throw error;
    }
  };
  const statement = (real: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const writes = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
    const after = async <T>(done: () => Promise<T>) => {
      alive();
      const value = await done();
      if (/checkpoint = \?/.test(sql)) checkpoints += (value as D1Result).meta.changes;
      if (writes) await boundary(`d1 ${sql.trim().slice(0, 40)}`);
      return value;
    };
    return {
      real,
      bind: (...values: unknown[]) => statement(real.bind(...values), sql),
      run: () => after(() => real.run()),
      all: () => after(() => real.all()),
      first: (...column: [string?]) => after(() => real.first(...(column as [string]))),
    } as unknown as D1PreparedStatement;
  };
  const DB = {
    prepare: (sql: string) => statement(t.env.DB.prepare(sql), sql),
    batch: async (list: D1PreparedStatement[]) => {
      alive();
      const results = await t.env.DB.batch(list.map((item) => (item as unknown as { real: D1PreparedStatement }).real));
      await boundary('d1 batch');
      return results;
    },
  } as unknown as D1Database;
  const STORES = {
    getByName: (name: string) => {
      const stub = t.env.STORES.getByName(name) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      return new Proxy(
        {},
        {
          get: (_, method) =>
            typeof method !== 'string' || method === 'then'
              ? undefined
              : async (...args: unknown[]) => {
                  alive();
                  if (method === 'arm') arms.push(args[2] as string);
                  const settled = await stub[method]!(...args).then(
                    (value) => ({ value }),
                    (error: unknown) => ({ error }),
                  );
                  await boundary(`store ${method}`);
                  if ('error' in settled) throw settled.error;
                  return settled.value;
                },
        },
      );
    },
  } as unknown as Env['STORES'];
  const BLOBS = Object.assign(Object.create(t.env.BLOBS) as R2Bucket, {
    list: (options?: R2ListOptions) => {
      alive();
      return t.env.BLOBS.list(options);
    },
    delete: async (keys: string | string[]) => {
      alive();
      await t.env.BLOBS.delete(keys);
      await boundary('r2 delete');
    },
  });
  return { env: { ...env(), DB, STORES, BLOBS }, arms, checkpoints: () => checkpoints };
}

// Counts the boundaries of a run, crashes after the nth, or pauses after the nth until released.
const counting = () => {
  let count = 0;
  return { ...watched(() => void count++), count: () => count };
};
const crashing = (n: number) => {
  let count = 0;
  return watched((what) => {
    if (++count === n) throw new Crash(what);
  });
};
function pausing(n: number) {
  let count = 0;
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const watching = watched(async () => {
    if (++count !== n) return;
    reach();
    await released;
  });
  return { ...watching, reached, release };
}

// An account whose store holds A 'old' from an hour ago, then A 'new' and B from half an hour ago, and an open report.
// at: a time between the two, so a restore to it leaves A 'old' alone.
async function seeded(username = `u${crypto.randomUUID().slice(0, 8)}`) {
  const now = Date.now();
  t.clock.now = () => now - HOUR_MS;
  const body = signupBody(username);
  const cookie = sessionCookie(await t.post('signup', body));
  const { incarnation, timeline } = (await account(body.accountId))!;
  // Straight to the store, as the batch route would: these tests are about what happens around it.
  const write = (...writes: Write[]) => t.stores.getByName(incarnation).batch(incarnation, timeline, writes, null);
  await write({ id: A, kind: 'chat', parent: null, body: 'old', baseRev: null, file: null });
  t.clock.now = () => now - HOUR_MS / 2;
  await write({ id: A, kind: 'chat', parent: null, body: 'new', baseRev: 1, file: null }, { id: B, kind: 'chat', parent: null, body: 'b', baseRev: null, file: null });
  t.clock.now = () => Date.now();
  const report = await reported(body.accountId);
  return { id: body.accountId, body, cookie, report, incarnation, timeline, at: now - (3 * HOUR_MS) / 4 };
}

const reported = async (accountId: string) =>
  (await t.env.DB.prepare("INSERT INTO reports (account_id, username, text, created_at) VALUES (?, '', '', ?) RETURNING id").bind(accountId, Date.now()).first<number>('id'))!;

const account = (id: string) => t.env.DB.prepare('SELECT incarnation, state, timeline, operation FROM accounts WHERE id = ?').bind(id).first<{ incarnation: string; state: string; timeline: string; operation: number | null }>();
const operation = (id: number) => t.env.DB.prepare('SELECT phase, verified, target, error FROM restores WHERE id = ?').bind(id).first<{ phase: Phase; verified: number; target: string | null; error: string | null }>();
// Log rows of an action, about one operation when it is named.
const logged = async (action: string, operation?: number) =>
  (await t.env.DB.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = ?1 AND (?2 IS NULL OR json_extract(detail, '$.operation') = ?2)")
    .bind(action, operation ?? null)
    .first<number>('n'))!;

// What a device that holds nothing reads from the account.
async function contents(cookie: string) {
  const { changes } = (await (await t.get('objects?since=0', cookie)).json()) as { changes: { id: string; body: string | null }[] };
  return Object.fromEntries(changes.filter(({ body }) => body !== null).map(({ id, body }) => [id, body]));
}

async function begin(seed: Awaited<ReturnType<typeof seeded>>, from: { at: number } | { undoes: number } = { at: seed.at }) {
  const begun = await beginRestore(env(), seed.id, seed.report, from);
  if (!('begun' in begun)) throw new Error(`refused: ${begun.refused}`);
  return begun.begun;
}

// A finished restore: done and verified, the account active on the restore's timeline with the target's objects, one
// done row, and every arm naming the one target. Its checkpoint, the undo, holds the state the restore replaced: read
// straight from the store's bookmarks, which ends the store's use in the test.
async function expectRestored(seed: Awaited<ReturnType<typeof seeded>>, id: number, arms: string[]) {
  const ended = (await operation(id))!;
  expect(ended).toMatchObject({ phase: 'done', verified: 1, error: null });
  expect(arms.every((target) => target === ended.target)).toBe(true);
  expect(await account(seed.id)).toMatchObject({ state: 'active', operation: null });
  expect((await account(seed.id))!.timeline).not.toBe(seed.timeline);
  expect(await contents(seed.cookie)).toEqual(AT_TARGET);
  expect(await logged('restore-done', id)).toBe(1);
  const checkpoint = (await t.env.DB.prepare('SELECT checkpoint FROM restores WHERE id = ?').bind(id).first<string>('checkpoint'))!;
  const db = t.stores.db(seed.incarnation);
  await db.bookmarks.restoreOnNextSession(checkpoint);
  db.restart();
  const page = (await t.stores.getByName(seed.incarnation).feed(seed.incarnation, { timeline: null, since: 0, known: 0, until: null, bootstrap: false, metadata: false, excluded: [], parent: null })) as FeedPage;
  expect(Object.fromEntries(page.changes.map(({ id, body }) => [id, body]))).toEqual(BEFORE);
}

describe('a restore', () => {
  it('runs in the operator request, is listed with its undo, and its undo gives back the state it replaced', async () => {
    const seed = await seeded();
    const admin = await seeded('operator');
    t.env.ADMIN_ACCOUNT = admin.id;
    const restored = await t.post(`admin/accounts/${seed.id}/restores`, { report: seed.report, at: seed.at }, admin.cookie);
    const { id } = (await restored.json()) as { id: number };
    expect(await contents(seed.cookie)).toEqual(AT_TARGET);
    const listed = (await (await t.get(`admin/accounts/${seed.id}/restores`, admin.cookie)).json()) as { restores: Record<string, unknown>[] };
    expect(listed.restores).toEqual([
      { id, reportId: seed.report, at: seed.at, undoes: null, phase: 'done', verified: true, error: null, createdAt: expect.any(Number), updatedAt: expect.any(Number), canUndo: true, undoExpiresAt: expect.any(Number), actions: [] },
    ]);

    const report = await reported(seed.id);
    const undone = await t.post(`admin/accounts/${seed.id}/restores`, { report, undoes: id }, admin.cookie);
    expect(await undone.json()).toEqual({ id: expect.any(Number), phase: 'done', verified: true, error: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    const relisted = (await (await t.get(`admin/accounts/${seed.id}/restores`, admin.cookie)).json()) as { restores: { undoes: number | null; canUndo: boolean }[] };
    expect(relisted.restores.map(({ undoes, canUndo }) => ({ undoes, canUndo }))).toEqual([{ undoes: id, canUndo: true }, { undoes: null, canUndo: false }]);
    expect(await t.env.DB.prepare("SELECT action, detail FROM admin_log WHERE action LIKE 'restore-%' ORDER BY id").all()).toMatchObject({
      results: [{ action: 'restore-begun' }, { action: 'restore-done' }, { action: 'restore-begun', detail: expect.stringContaining(`"undoes":${id}`) }, { action: 'restore-done' }],
    });
  });

  it('begins only on an open report the account sent, a time 10 minutes to 29 days back, or an undo of its latest restore; a refusal leaves no row and no hold', async () => {
    const seed = await seeded();
    const other = await seeded('other');
    const refused = async (report: number, from: { at: number } | { undoes: number }) => {
      const begun = await beginRestore(env(), seed.id, report, from);
      return 'refused' in begun ? begun.refused : 'begun';
    };
    expect(await refused(other.report, { at: seed.at })).toBe('bad-report');
    expect(await refused(seed.report + 100, { at: seed.at })).toBe('bad-report');
    expect(await refused(seed.report, { at: Date.now() - 5 * 60_000 })).toBe('bad-time');
    expect(await refused(seed.report, { at: Date.now() - 30 * 24 * HOUR_MS })).toBe('bad-time');
    expect(await refused(seed.report, { undoes: 1 })).toBe('cannot-undo');
    await t.env.DB.prepare('UPDATE reports SET resolved_at = 1 WHERE id = ?').bind(seed.report).run();
    expect(await refused(seed.report, { at: seed.at })).toBe('bad-report');
    expect(await t.env.DB.prepare('SELECT COUNT(*) AS n FROM restores').first('n')).toBe(0);
    expect(await account(seed.id)).toMatchObject({ state: 'active', operation: null });

    await t.env.DB.prepare('UPDATE reports SET resolved_at = NULL').run();
    await begin(other);
    expect(await beginRestore(env(), other.id, other.report, { at: other.at })).toEqual({ refused: 'account-busy' });
    expect(await logged('restore-begun')).toBe(1);
  });

  it('cancels before arming, giving the account back on its timeline with its objects, and refuses once armed', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('targeted').env, id)).rejects.toThrow(Crash);
    expect((await operation(id))!.phase).toBe('targeted');
    expect(await cancelRestore(env(), id)).toEqual({ id, phase: 'cancelled', verified: true, error: null });
    expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline, operation: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    expect(t.stores.db(seed.incarnation).kv.get(`restore:${id}`)).toBeUndefined();
    expect(await cancelRestore(env(), id)).toMatchObject({ phase: 'cancelled' });
    expect(await logged('restore-cancelled')).toBe(1);

    const armed = await begin({ ...seed, report: seed.report }, { at: seed.at });
    await expect(runRestore(pausedAt('armed').env, armed)).rejects.toThrow(Crash);
    expect(await cancelRestore(env(), armed)).toBe('too-late');
    await expectRestored(seed, (await runRestore(env(), armed))!.id, []);
  });

  it('fails one asking for a time before the store existed, and one whose target expired before arming, giving the account back', async () => {
    const seed = await seeded();
    const early = await beginRestore(env(), seed.id, seed.report, { at: seed.at - HOUR_MS });
    expect(await runRestore(env(), (early as { begun: number }).begun)).toMatchObject({ phase: 'failed', verified: true, error: 'too-early' });
    expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline });

    const expiring = await begin(seed);
    await expect(runRestore(pausedAt('targeted').env, expiring)).rejects.toThrow(Crash);
    await t.env.DB.prepare('UPDATE restores SET at = ? WHERE id = ?').bind(Date.now() - 31 * 24 * HOUR_MS, expiring).run();
    expect(await runRestore(env(), expiring)).toMatchObject({ phase: 'failed', verified: true, error: 'target-expired' });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    expect(await logged('restore-failed')).toBe(2);
  });

  it('is finalized again and again once the store is seen on its new timeline', async () => {
    const seed = await seeded();
    const admin = await seeded('operator');
    t.env.ADMIN_ACCOUNT = admin.id;
    const id = await begin(seed);
    await expect(runRestore(pausedAt('done').env, id)).rejects.toThrow(Crash);
    expect(await operation(id)).toMatchObject({ phase: 'done', verified: 0 });
    expect((await (await t.get(`admin/accounts/${seed.id}/restores`, admin.cookie)).json()) as object).toMatchObject({ restores: [{ id, actions: ['finalize'] }] });
    for (let i = 0; i < 2; i++) expect(await (await t.post(`admin/restores/${id}/finalize`, undefined, admin.cookie)).json()).toEqual({ id, phase: 'done', verified: true, error: null });
    await expectRestored(seed, id, []);
  });

  it('ends restored, or cancelled when cancelled before arming, after a crash at every durable boundary', async () => {
    const probe = counting();
    await runRestore(probe.env, await begin(await seeded()));
    const total = probe.count();
    expect(total).toBeGreaterThan(10);
    // A crash that leaves the operation before armed is followed once by a resume and once by a cancel.
    const crashAt = async (n: number, cancel: boolean) => {
      const seed = await seeded();
      const id = await begin(seed);
      const crashed = crashing(n);
      await expect(runRestore(crashed.env, id)).rejects.toThrow(Crash);
      const { phase } = (await operation(id))!;
      const rerun = counting();
      if (cancel) {
        expect(await cancelRestore(rerun.env, id)).toMatchObject({ phase: 'cancelled', verified: true });
        expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline, operation: null });
        expect(await contents(seed.cookie)).toEqual(BEFORE);
        expect(await logged('restore-cancelled', id)).toBe(1);
        return true;
      }
      await runRestore(rerun.env, id);
      expect(crashed.checkpoints() + rerun.checkpoints()).toBe(1);
      await expectRestored(seed, id, [...crashed.arms, ...rerun.arms]);
      return BEFORE_ARMED.includes(phase);
    };
    const cancellable: number[] = [];
    for (let n = 1; n <= total; n++) if (await crashAt(n, false)) cancellable.push(n);
    expect(cancellable.length).toBeGreaterThan(3);
    for (const n of cancellable) await crashAt(n, true);
  }, 120_000);

  it('ends restored once when two runs of it interleave at every step, and leaves another operation alone', async () => {
    const probe = counting();
    await runRestore(probe.env, await begin(await seeded()));
    const total = probe.count();
    const other = await seeded();
    const held = await begin(other);
    // The first run pauses after its nth boundary while a second runs to its end; then the first goes on from what it
    // read before.
    for (let n = 1; n <= total; n++) {
      const seed = await seeded();
      const id = await begin(seed);
      const first = pausing(n);
      const running = runRestore(first.env, id);
      await Promise.race([first.reached, running]);
      const second = counting();
      await runRestore(second.env, id);
      first.release();
      await running;
      expect(first.checkpoints() + second.checkpoints()).toBe(1);
      await expectRestored(seed, id, [...first.arms, ...second.arms]);
    }
    expect(await operation(held)).toMatchObject({ phase: 'begun', verified: 0 });
    expect(await account(other.id)).toMatchObject({ state: 'restoring', operation: held });
  }, 120_000);
});

describe('a deletion', () => {
  async function holding() {
    const body = signupBody(`u${crypto.randomUUID().slice(0, 8)}`);
    const cookie = sessionCookie(await t.post('signup', body));
    await t.batch([{ id: A, kind: 'chat', parent: null, body: 'sealed', baseRev: null }], cookie);
    const bytes = new Uint8Array([1, 2, 3]);
    const file = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    expect((await t.put(`files/${file}`, bytes, cookie)).status).toBe(204);
    const { incarnation } = (await account(body.accountId))!;
    return { id: body.accountId, body, cookie, incarnation, file, bytes };
  }

  const gone = async ({ id, incarnation }: { id: string; incarnation: string }) => {
    expect(await account(id)).toBeNull();
    expect(t.stores.db(incarnation).tables()).toEqual([]);
    expect((await t.env.BLOBS.list({ prefix: `files/${incarnation}/` })).objects).toEqual([]);
  };

  it('finishes when run again after a crash at every durable boundary, and logs the deletion once', async () => {
    const probe = counting();
    const first = await holding();
    expect(await leaveAccount(probe.env, first.id, first.incarnation, true)).toBe('left');
    const total = probe.count();
    expect(total).toBeGreaterThan(4);
    for (let n = 1; n <= total; n++) {
      const held = await holding();
      await expect(leaveAccount(crashing(n).env, held.id, held.incarnation, true)).rejects.toThrow(Crash);
      expect(await leaveAccount(env(), held.id, held.incarnation, true)).toBe('left');
      await gone(held);
      expect(await t.env.DB.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'delete-account' AND target = ?").bind(held.id).first('n')).toBe(1);
    }
  }, 60_000);

  it('answers busy while the account restores', async () => {
    const seed = await seeded();
    await begin(seed);
    expect(await leaveAccount(env(), seed.id, seed.incarnation, false)).toBe('busy');
    expect(await account(seed.id)).toMatchObject({ state: 'restoring' });
  });
});

describe('an account id used again', () => {
  it('gets a new incarnation that sees nothing of the old one: no objects, pictures, usage or held files', async () => {
    const seed = await seeded();
    const bytes = new Uint8Array([7]);
    const file = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    await t.put(`files/${file}`, bytes, seed.cookie);
    expect(await leaveAccount(env(), seed.id, seed.incarnation, false)).toBe('left');

    const again = sessionCookie(await t.post('signup', { ...signupBody(), accountId: seed.id }));
    expect((await account(seed.id))!.incarnation).not.toBe(seed.incarnation);
    expect(await contents(again)).toEqual({});
    expect(await (await t.post('files/missing', { ids: [file] }, again)).json()).toEqual({ missing: [file] });
    expect(await (await t.get('session', again)).json()).toMatchObject({ session: { storage: { bytes: 0, fileBytes: 0 } } });
  });

  it("is safe from the old account's late runs: a deletion paused before its last step, and a finalize", async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('done').env, id)).rejects.toThrow(Crash);
    // The old account's deletion, paused just before it deletes the row; another run of it finishes meanwhile.
    const probe = counting();
    await leaveAccount(probe.env, seed.id, seed.incarnation, false);
    await fresh();
    const old = await seeded();
    const finishing = await begin(old);
    await expect(runRestore(pausedAt('done').env, finishing)).rejects.toThrow(Crash);
    const late = pausing(probe.count() - 1);
    const leaving = leaveAccount(late.env, old.id, old.incarnation, false);
    await late.reached;
    expect(await leaveAccount(env(), old.id, old.incarnation, false)).toBe('left');

    const again = sessionCookie(await t.post('signup', { ...signupBody(), accountId: old.id }));
    await t.batch([{ id: B, kind: 'chat', parent: null, body: 'mine', baseRev: null }], again);
    late.release();
    expect(await leaving).toBe('left');
    expect(await runRestore(env(), finishing)).toBeNull();
    const renewed = (await account(old.id))!;
    expect(renewed.state).toBe('active');
    expect(await contents(again)).toEqual({ [B]: 'mine' });
    expect(await t.stores.getByName(renewed.incarnation).status(renewed.incarnation)).toEqual({ state: 'active', timeline: renewed.timeline, operation: null });
  });
});

// Runs until the operation's phase is the one named, then crashes: the phase is read after every boundary.
function pausedAt(phase: Phase) {
  return watched(async (what) => {
    const reached = await t.env.DB.prepare('SELECT 1 FROM restores WHERE phase = ? AND verified = 0').bind(phase).first();
    if (reached) throw new Crash(what);
  });
}
