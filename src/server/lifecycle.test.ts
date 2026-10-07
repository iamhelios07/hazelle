import { rmSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RestorePhase } from '../contracts/admin';
import type { Write } from './account-store';
import { expireSnapshots } from './backup/snapshots';
import { snapshotPath, type Stores } from './db/account-db';
import type { Db, Result, Statement } from './db/service-db';
import { MAX_FILE_BYTES } from './files';
import type { Bucket } from './files/disk-bucket';
import { hex, type Services } from './http';
import { beginRestore, cancelRestore, leaveAccount, runRestore } from './lifecycle';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(fresh);

// The installation's sole operator: the first signup after every reset, so any other account can be deleted.
let operator: Awaited<ReturnType<typeof signedUp>>;
async function fresh() {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 1000').run();
  operator = await signedUp('operator');
}

const HOUR_MS = 3_600_000;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const BEFORE: Record<string, string> = { [A]: 'new', [B]: 'b' };
const AT_TARGET: Record<string, string> = { [A]: 'old' };
const BEFORE_ARMED: RestorePhase[] = ['begun', 'fenced', 'checkpointed', 'targeted'];

class Crash extends Error {}

// env with every durable boundary passing through hook once it is over: a service write committed, a store call
// answered (restart included), a picture directory removed. A hook that throws is a crash right after that boundary;
// one that waits pauses the runner there. Once a hook has thrown, the runner is dead: every later call throws before it
// does anything, since the code swallows the failure of a restart by design. arms: the target of every arm call that
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
  const statement = (real: Statement, sql: string): Statement => {
    const writes = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
    const after = async <T>(done: () => Promise<T>) => {
      alive();
      const value = await done();
      if (/checkpoint = \?/.test(sql)) checkpoints += (value as Result).meta.changes;
      if (writes) await boundary(`db ${sql.trim().slice(0, 40)}`);
      return value;
    };
    return {
      real,
      bind: (...values: Parameters<Statement['bind']>) => statement(real.bind(...values), sql),
      run: () => after(() => real.run()),
      all: () => after(() => real.all()),
      first: (...column: [string?]) => after(() => real.first(...(column as [string]))),
    } as unknown as Statement;
  };
  const db: Db = {
    prepare: (sql) => statement(t.env.db.prepare(sql), sql),
    // The service runs a batch through the real statements' own handle, which the wrappers do not carry.
    batch: async (list) => {
      alive();
      const results = await t.env.db.batch(list.map((item) => (item as unknown as { real: Statement }).real));
      await boundary('db batch');
      return results as never;
    },
  };
  const stores: Stores = {
    ...t.env.stores,
    getByName: (name) => {
      const stub = t.env.stores.getByName(name) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
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
      ) as ReturnType<Stores['getByName']>;
    },
  };
  const files: Bucket = {
    ...t.env.files,
    deletePrefix: async (prefix) => {
      alive();
      await t.env.files.deletePrefix(prefix);
      await boundary('files deletePrefix');
    },
  };
  return { env: { ...t.env, db, stores, files } satisfies Services, arms, checkpoints: () => checkpoints };
}

// A deletion with the work it leaves running after its answer awaited, so a crash there fails the run too.
async function leave(on: Services, id: string, incarnation: string, operator: boolean) {
  const after: Promise<unknown>[] = [];
  const left = await leaveAccount(on, { waitUntil: (work) => void after.push(work) }, id, incarnation, operator);
  await Promise.all(after);
  return left;
}

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
function pausing(at: (what: string, count: number) => boolean) {
  let count = 0;
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const watching = watched(async (what) => {
    if (!at(what, ++count)) return;
    reach();
    await released;
  });
  return { ...watching, reached, release };
}

async function signedUp(username = `u${crypto.randomUUID().slice(0, 8)}`) {
  const body = signupBody(username);
  const cookie = sessionCookie(await t.post('signup', body));
  const { incarnation, timeline } = (await account(body.accountId))!;
  return { id: body.accountId, body, cookie, incarnation, timeline };
}

// An account whose store holds A 'old' from an hour ago, kept in a baseline snapshot, then A 'new' and B from half an
// hour ago, and an open report. at: a time between the two, so a restore to it leaves A 'old' alone.
async function seeded() {
  const now = Date.now();
  t.clock.now = () => now - HOUR_MS;
  const user = await signedUp();
  const { incarnation, timeline } = user;
  // Straight to the store, as the batch route would: these tests are about what happens around it.
  const write = (...writes: Write[]) => t.stores.getByName(incarnation).batch(incarnation, timeline, writes, null);
  await write({ id: A, kind: 'chat', parent: null, body: 'old', baseRev: null });
  await t.stores.snapshot(incarnation, 'baseline');
  t.clock.now = () => now - HOUR_MS / 2;
  await write({ id: A, kind: 'chat', parent: null, body: 'new', baseRev: 1 }, { id: B, kind: 'chat', parent: null, body: 'b', baseRev: null });
  t.clock.now = () => Date.now();
  const report = await reported(user.id, user.cookie);
  return { ...user, report, at: now - (3 * HOUR_MS) / 4 };
}

async function reported(accountId: string, cookie: string) {
  expect((await t.post('reports', { text: 'restore' }, cookie)).status).toBe(204);
  return (await t.env.db.prepare('SELECT MAX(id) AS id FROM reports WHERE account_id = ?').bind(accountId).first<number>('id'))!;
}

const account = (id: string) => t.env.db.prepare('SELECT incarnation, state, timeline, operation FROM accounts WHERE id = ?').bind(id).first<{ incarnation: string; state: string; timeline: string; operation: number | null }>();
const operation = (id: number) => t.env.db.prepare('SELECT phase, verified, target, error FROM restores WHERE id = ?').bind(id).first<{ phase: RestorePhase; verified: number; target: string | null; error: string | null }>();
const logged = async (action: string, operation?: number) =>
  (await t.env.db
    .prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = ?1 AND (?2 IS NULL OR json_extract(detail, '$.operation') = ?2)")
    .bind(action, operation ?? null)
    .first<number>('n'))!;
const mark = (incarnation: string, id: number) => t.stores.inspect(incarnation).exec('SELECT value FROM kv WHERE key = ?', `restore:${id}`);

async function contents(cookie: string) {
  const { changes } = (await (await t.get('objects?since=0', cookie)).json()) as { changes: { id: string; body: string | null }[] };
  return Object.fromEntries(changes.filter(({ body }) => body !== null).map(({ id, body }) => [id, body]));
}

async function begin(seed: Awaited<ReturnType<typeof seeded>>, from: { at: number } | { undoes: number } = { at: seed.at }) {
  const begun = await beginRestore(t.env, seed.id, seed.report, from);
  if (!('begun' in begun)) throw new Error(`refused: ${begun.refused}`);
  return begun.begun;
}

// Its checkpoint holds the state the restore replaced: an undo of it gives that state back, which ends the restore's
// use in the test.
async function expectRestored(seed: Awaited<ReturnType<typeof seeded>>, id: number, arms: string[]) {
  const ended = (await operation(id))!;
  expect(ended).toMatchObject({ phase: 'done', verified: 1, error: null });
  expect(arms.every((target) => target === ended.target)).toBe(true);
  expect(await account(seed.id)).toMatchObject({ state: 'active', operation: null });
  expect((await account(seed.id))!.timeline).not.toBe(seed.timeline);
  expect(await contents(seed.cookie)).toEqual(AT_TARGET);
  expect(await logged('restore-done', id)).toBe(1);
  expect(await runRestore(t.env, await begin(seed, { undoes: id }))).toMatchObject({ phase: 'done', verified: true, error: null });
  expect(await contents(seed.cookie)).toEqual(BEFORE);
}

describe('a restore', () => {
  it('runs in the operator request, is listed with its undo, and its undo gives back the state it replaced', async () => {
    const seed = await seeded();
    const restored = await t.post(`admin/accounts/${seed.id}/restores`, { report: seed.report, at: seed.at }, operator.cookie);
    const { id } = (await restored.json()) as { id: number };
    expect(await contents(seed.cookie)).toEqual(AT_TARGET);
    const listed = (await (await t.get(`admin/accounts/${seed.id}/restores`, operator.cookie)).json()) as { restores: Record<string, unknown>[] };
    expect(listed.restores).toEqual([
      { id, reportId: seed.report, at: seed.at, undoes: null, targetAt: seed.at - HOUR_MS / 4, phase: 'done', verified: true, error: null, createdAt: expect.any(Number), updatedAt: expect.any(Number), canUndo: true, undoExpiresAt: expect.any(Number), actions: [] },
    ]);

    const report = await reported(seed.id, seed.cookie);
    const undone = await t.post(`admin/accounts/${seed.id}/restores`, { report, undoes: id }, operator.cookie);
    expect(await undone.json()).toEqual({ id: expect.any(Number), phase: 'done', verified: true, error: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    const relisted = (await (await t.get(`admin/accounts/${seed.id}/restores`, operator.cookie)).json()) as { restores: { undoes: number | null; canUndo: boolean }[] };
    expect(relisted.restores.map(({ undoes, canUndo }) => ({ undoes, canUndo }))).toEqual([{ undoes: id, canUndo: true }, { undoes: null, canUndo: false }]);
    expect(await t.env.db.prepare("SELECT action, detail FROM admin_log WHERE action LIKE 'restore-%' ORDER BY id").all()).toMatchObject({
      results: [{ action: 'restore-begun' }, { action: 'restore-done' }, { action: 'restore-begun', detail: expect.stringContaining(`"undoes":${id}`) }, { action: 'restore-done' }],
    });
  });

  it('begins only on an open report the account sent, a time 10 minutes to 6 days back, or an undo of its latest restore; a refusal leaves no row and no hold', async () => {
    const seed = await seeded();
    const other = await seeded();
    const refused = async (report: number, from: { at: number } | { undoes: number }) => {
      const begun = await beginRestore(t.env, seed.id, report, from);
      return 'refused' in begun ? begun.refused : 'begun';
    };
    expect(await refused(other.report, { at: seed.at })).toBe('bad-report');
    expect(await refused(seed.report + 100, { at: seed.at })).toBe('bad-report');
    expect(await refused(seed.report, { at: Date.now() - 5 * 60_000 })).toBe('bad-time');
    expect(await refused(seed.report, { at: Date.now() - 7 * 24 * HOUR_MS })).toBe('bad-time');
    expect(await refused(seed.report, { undoes: 1 })).toBe('cannot-undo');
    await t.env.db.prepare('UPDATE reports SET resolved_at = 1 WHERE id = ?').bind(seed.report).run();
    expect(await refused(seed.report, { at: seed.at })).toBe('bad-report');
    expect(await t.env.db.prepare('SELECT COUNT(*) AS n FROM restores').first('n')).toBe(0);
    expect(await account(seed.id)).toMatchObject({ state: 'active', operation: null });

    await t.env.db.prepare('UPDATE reports SET resolved_at = NULL').run();
    await begin(other);
    expect(await beginRestore(t.env, other.id, other.report, { at: other.at })).toEqual({ refused: 'account-busy' });
    expect(await logged('restore-begun')).toBe(1);
  });

  it('allows the undo for 7 days after the restore ended, however long before that its checkpoint was taken', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await runRestore(t.env, id);
    const now = Date.now();
    await t.env.db.prepare('UPDATE restores SET checkpoint_at = ?, ended_at = ? WHERE id = ?').bind(now - 12 * 24 * HOUR_MS, now - 6 * 24 * HOUR_MS, id).run();
    const listed = (await (await t.get(`admin/accounts/${seed.id}/restores`, operator.cookie)).json()) as { restores: { undoExpiresAt: number }[] };
    expect(listed.restores[0]!.undoExpiresAt).toBe(now + 24 * HOUR_MS);
    await t.env.db.prepare('UPDATE restores SET ended_at = ? WHERE id = ?').bind(now - 7 * 24 * HOUR_MS - 60_000, id).run();
    expect(await beginRestore(t.env, seed.id, seed.report, { undoes: id })).toEqual({ refused: 'cannot-undo' });
    await t.env.db.prepare('UPDATE restores SET ended_at = ? WHERE id = ?').bind(now - 6 * 24 * HOUR_MS, id).run();
    expect(await beginRestore(t.env, seed.id, seed.report, { undoes: id })).toHaveProperty('begun');
  });

  it('keeps the checkpoint an undo will install pinned from its begin, past the end of the undone restore’s own pin', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await runRestore(t.env, id);
    const undo = await begin({ ...seed, report: await reported(seed.id, seed.cookie) }, { undoes: id });
    t.restartProcess();
    // 8 days on, the undone restore's own pin has lapsed.
    await expireSnapshots(t.env, t.dir, Date.now() + 8 * 24 * HOUR_MS);
    expect(await runRestore(t.env, undo)).toMatchObject({ phase: 'done', verified: true, error: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
  });

  it('stops an undo whose checkpoint is lost before arming it, and lets it be cancelled', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await runRestore(t.env, id);
    const { checkpoint } = (await t.env.db.prepare('SELECT checkpoint FROM restores WHERE id = ?').bind(id).first<{ checkpoint: string }>())!;
    rmSync(snapshotPath(t.dir, seed.incarnation, checkpoint));
    const undo = await begin({ ...seed, report: await reported(seed.id, seed.cookie) }, { undoes: id });
    expect(await runRestore(t.env, undo)).toEqual({ id: undo, phase: 'checkpointed', verified: false, error: 'store-unavailable' });
    expect(await cancelRestore(t.env, undo)).toMatchObject({ phase: 'cancelled', verified: true });
    expect(await contents(seed.cookie)).toEqual(AT_TARGET);
  });

  it('cancels before arming, giving the account back on its timeline with its objects, and refuses once armed', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('targeted').env, id)).rejects.toThrow(Crash);
    expect((await operation(id))!.phase).toBe('targeted');
    expect(await cancelRestore(t.env, id)).toEqual({ id, phase: 'cancelled', verified: true, error: null });
    expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline, operation: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    expect(mark(seed.incarnation, id)).toEqual([]);
    expect(await cancelRestore(t.env, id)).toMatchObject({ phase: 'cancelled' });
    expect(await logged('restore-cancelled')).toBe(1);

    const armed = await begin(seed);
    await expect(runRestore(pausedAt('armed').env, armed)).rejects.toThrow(Crash);
    expect(await cancelRestore(t.env, armed)).toBe('too-late');
    await expectRestored(seed, (await runRestore(t.env, armed))!.id, []);
  });

  it('repairs, by finalizing, a store left refusing as restoring by a cancel cut off before its restart', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('targeted').env, id)).rejects.toThrow(Crash);
    await expect(cancelRestore(crashing(1).env, id)).rejects.toThrow(Crash);
    expect(await account(seed.id)).toMatchObject({ state: 'active', operation: null });
    expect((await t.get('objects?since=0', seed.cookie)).status).toBe(503);
    expect(await runRestore(t.env, id)).toEqual({ id, phase: 'cancelled', verified: true, error: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    expect(mark(seed.incarnation, id)).toEqual([]);
  });

  it('fails one asking for a time before the store existed, giving the account back', async () => {
    const seed = await seeded();
    const early = await beginRestore(t.env, seed.id, seed.report, { at: seed.at - HOUR_MS });
    expect(await runRestore(t.env, (early as { begun: number }).begun)).toMatchObject({ phase: 'failed', verified: true, error: 'too-early' });
    expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline });
    expect(await logged('restore-failed')).toBe(1);
  });

  it('never lands a later restore on a snapshot taken before a finished one, until the daily job takes a baseline after it, though the file holds that baseline’s revision', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await runRestore(t.env, id);
    const later = Date.now() + 1;
    expect(await t.stores.snapshotAt(seed.incarnation, later)).toBeNull();
    const recorded = await t.env.db.prepare("SELECT rev FROM snapshots WHERE incarnation = ? AND kind = 'baseline'").bind(seed.incarnation).first<number>('rev');
    expect(t.stores.inspect(seed.incarnation).exec<{ rev: number }>('SELECT rev FROM head')).toEqual([{ rev: recorded }]);
    expect(await t.daily(later)).toMatchObject({ snapshots: { outcome: 'ok' } });
    expect(await t.stores.snapshotAt(seed.incarnation, later)).toEqual({ id: expect.any(String), takenAt: later });
  });

  it('lets no write or answer of an old timeline back in across a rewind, revisions after it and its undo', async () => {
    const seed = await seeded();
    const write = (timeline: string, id: string, body: string, baseRev: number | null) =>
      t.post('objects/batch', { timeline, writes: [{ id, kind: 'chat', parent: null, body, baseRev }] }, seed.cookie);
    // The offline tab: its write and its feed both name the timeline it last pulled.
    const held = () => write(seed.timeline, A, 'offline edit', 2);
    const heldFeed = () => t.get(`objects?since=0&timeline=${seed.timeline}`, seed.cookie);
    const id = await begin(seed);
    await runRestore(t.env, id);
    const rewound = (await account(seed.id))!.timeline;
    expect((await write(rewound, B, 'after', null)).status).toBe(200);
    expect((await write(rewound, B, 'after again', 2)).status).toBe(200);
    expect((await held()).status).toBe(409);
    expect((await heldFeed()).status).toBe(409);
    await runRestore(t.env, await begin({ ...seed, report: await reported(seed.id, seed.cookie) }, { undoes: id }));
    expect((await held()).status).toBe(409);
    expect((await heldFeed()).status).toBe(409);
    expect((await write(rewound, B, 'late', 3)).status).toBe(409);
    expect(await contents(seed.cookie)).toEqual(BEFORE);
  });

  it('is finalized again and again once the store is seen on its new timeline', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('done').env, id)).rejects.toThrow(Crash);
    expect(await operation(id)).toMatchObject({ phase: 'done', verified: 0 });
    expect((await (await t.get(`admin/accounts/${seed.id}/restores`, operator.cookie)).json()) as object).toMatchObject({ restores: [{ id, actions: ['finalize'] }] });
    for (let i = 0; i < 2; i++) expect(await (await t.post(`admin/restores/${id}/finalize`, undefined, operator.cookie)).json()).toEqual({ id, phase: 'done', verified: true, error: null });
    await expectRestored(seed, id, []);
  });

  it('ends restored by two resumes at once, or cancelled when cancelled before arming, after a throw and a registry restart at every durable boundary', async () => {
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
      t.restartProcess();
      const { phase } = (await operation(id))!;
      const rerun = counting();
      if (cancel) {
        expect(await cancelRestore(rerun.env, id)).toMatchObject({ phase: 'cancelled', verified: true });
        expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline, operation: null });
        expect(await contents(seed.cookie)).toEqual(BEFORE);
        expect(await logged('restore-cancelled', id)).toBe(1);
        return true;
      }
      const twin = counting();
      await Promise.all([runRestore(rerun.env, id), runRestore(twin.env, id)]);
      expect(crashed.checkpoints() + rerun.checkpoints() + twin.checkpoints()).toBe(1);
      await expectRestored(seed, id, [...crashed.arms, ...rerun.arms, ...twin.arms]);
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
      const first = pausing((_, count) => count === n);
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
    const user = await signedUp();
    await t.batch([{ id: A, kind: 'chat', parent: null, body: 'sealed', baseRev: null }], user.cookie);
    const bytes = new Uint8Array([1, 2, 3]);
    const file = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    expect((await t.put(`files/${file}`, bytes, user.cookie)).status).toBe(204);
    return { ...user, file, bytes };
  }

  const pictures = async ({ incarnation }: { incarnation: string }) => (await t.env.files.list(`files/${incarnation}/`)).length;

  const gone = async (held: { id: string; incarnation: string }) => {
    expect(await account(held.id)).toBeNull();
    expect(t.stores.inspect(held.incarnation).tables()).toEqual([]);
    expect(await pictures(held)).toBe(0);
  };

  it('finishes after a throw at every durable boundary, by running again or by the hourly reconciliation once the row is gone, and logs the deletion once', async () => {
    const probe = counting();
    const first = await holding();
    expect(await leave(probe.env, first.id, first.incarnation, true)).toBe('left');
    const total = probe.count();
    expect(total).toBeGreaterThan(4);
    for (let n = 1; n <= total; n++) {
      const held = await holding();
      await expect(leave(crashing(n).env, held.id, held.incarnation, true)).rejects.toThrow(Crash);
      expect(await leave(t.env, held.id, held.incarnation, true)).toBe('left');
      await t.reconcile(Date.now() + 2 * HOUR_MS);
      await gone(held);
      expect(await t.env.db.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'delete-account' AND target = ?").bind(held.id).first('n')).toBe(1);
    }
  }, 60_000);

  // The pictures' removal waits until released, as one still running after the answer.
  function heldDeletes() {
    const files = t.env.files;
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    t.env.files = {
      ...files,
      deletePrefix: async (prefix) => {
        await released;
        await files.deletePrefix(prefix);
      },
    };
    return () => {
      t.env.files = files;
      release();
    };
  }

  it('answers 탈퇴 once the store is emptied and the row gone, and removes the pictures after the answer', async () => {
    const held = await holding();
    const release = heldDeletes();
    expect((await t.delete('account', { method: 'password', proof: held.body.passwordProof }, held.cookie)).status).toBe(204);
    expect(await account(held.id)).toBeNull();
    expect(t.stores.inspect(held.incarnation).tables()).toEqual([]);
    expect(await pictures(held)).toBe(1);
    release();
    await t.settle();
    await gone(held);
  });

  it('frees the username and the signup place while the pictures are still being removed', async () => {
    const held = await holding();
    await t.env.db.prepare('UPDATE service SET signup_cap = (SELECT COUNT(*) FROM accounts)').run();
    const release = heldDeletes();
    expect((await t.delete('account', { method: 'password', proof: held.body.passwordProof }, held.cookie)).status).toBe(204);
    const again = signupBody(held.body.username);
    expect((await t.post('signup', again)).status).toBe(201);
    expect(await pictures(held)).toBe(1);
    release();
    await t.settle();
    await gone(held);
    expect(await account(again.accountId)).toMatchObject({ state: 'active' });
  });

  it('answers busy while the account restores', async () => {
    const seed = await seeded();
    await begin(seed);
    expect(await leave(t.env, seed.id, seed.incarnation, false)).toBe('busy');
    expect(await account(seed.id)).toMatchObject({ state: 'restoring' });
  });

  it('keeps the account row while a restart never reached the store, and finishes once one does', async () => {
    const held = await holding();
    const unreached: Services = {
      ...t.env,
      stores: {
        ...t.env.stores,
        getByName: (name) =>
          new Proxy(t.stores.getByName(name), {
            get: (stub, method) => (method === 'restart' ? () => Promise.reject(new Error('unreached')) : Reflect.get(stub, method)),
          }),
      },
    };
    expect(await leave(unreached, held.id, held.incarnation, false)).toBe('unavailable');
    expect(await account(held.id)).toMatchObject({ state: 'leaving' });
    expect(t.stores.inspect(held.incarnation).tables()).not.toEqual([]);
    expect(await pictures(held)).toBe(1);

    expect(await leave(t.env, held.id, held.incarnation, false)).toBe('left');
    await gone(held);
  });

  it('never takes the sole operator, by its own 탈퇴 or by the operator route, alone or beside other accounts', async () => {
    const refusedAll = async () => {
      expect(await leave(t.env, operator.id, operator.incarnation, false)).toBe('operator');
      expect(await leave(t.env, operator.id, operator.incarnation, true)).toBe('operator');
      const own = await t.delete('account', { method: 'password', proof: operator.body.passwordProof }, operator.cookie);
      expect([own.status, await own.json()]).toEqual([403, { error: 'sole-operator' }]);
      const route = await t.delete(`admin/accounts/${operator.id}`, undefined, operator.cookie);
      expect([route.status, await route.json()]).toEqual([403, { error: 'sole-operator' }]);
      expect(await account(operator.id)).toMatchObject({ state: 'active' });
      expect(await logged('delete-account')).toBe(0);
    };
    await refusedAll();
    const other = await signedUp();
    await refusedAll();
    expect((await t.delete(`admin/accounts/${other.id}`, undefined, operator.cookie)).status).toBe(204);
    expect(await account(other.id)).toBeNull();
  });
});

describe('an operation id', () => {
  it('is not given again after its account is deleted, so a request left holding it names nothing', async () => {
    const old = await seeded();
    const id = await begin(old);
    expect(await cancelRestore(t.env, id)).toMatchObject({ phase: 'cancelled', verified: true });
    expect(await leave(t.env, old.id, old.incarnation, false)).toBe('left');

    const next = await seeded();
    const current = await begin(next);
    expect(current).toBeGreaterThan(id);
    expect(await cancelRestore(t.env, id)).toBeNull();
    expect(await account(next.id)).toMatchObject({ state: 'restoring', operation: current });
  });
});

describe('an account id used again', () => {
  it('gets a new incarnation that sees nothing of the old one: no objects, pictures, usage or held files', async () => {
    const seed = await seeded();
    const bytes = new Uint8Array([7]);
    const file = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    await t.put(`files/${file}`, bytes, seed.cookie);
    expect(await leave(t.env, seed.id, seed.incarnation, false)).toBe('left');

    const again = sessionCookie(await t.post('signup', { ...signupBody(), accountId: seed.id }));
    expect((await account(seed.id))!.incarnation).not.toBe(seed.incarnation);
    expect(await contents(again)).toEqual({});
    expect(await (await t.post('files/missing', { ids: [file] }, again)).json()).toEqual({ missing: [file], maxBytes: MAX_FILE_BYTES });
    expect(await (await t.get('session', again)).json()).toMatchObject({ session: { storage: { bytes: 0, fileBytes: 0 } } });
  });

  it("is safe from the old account's late runs: a deletion paused before it deletes the row, and a finalize", async () => {
    const old = await seeded();
    const finishing = await begin(old);
    await expect(runRestore(pausedAt('done').env, finishing)).rejects.toThrow(Crash);
    // The old account's deletion, paused once the store is emptied; another run of it finishes meanwhile.
    const late = pausing((what) => what === 'store destroy');
    const leaving = leave(late.env, old.id, old.incarnation, false);
    await late.reached;
    expect(await leave(t.env, old.id, old.incarnation, false)).toBe('left');

    const again = sessionCookie(await t.post('signup', { ...signupBody(), accountId: old.id }));
    await t.batch([{ id: B, kind: 'chat', parent: null, body: 'mine', baseRev: null }], again);
    late.release();
    expect(await leaving).toBe('left');
    expect(await runRestore(t.env, finishing)).toBeNull();
    const renewed = (await account(old.id))!;
    expect(renewed.state).toBe('active');
    expect(await contents(again)).toEqual({ [B]: 'mine' });
    expect(await t.stores.getByName(renewed.incarnation).status(renewed.incarnation)).toEqual({ state: 'active', timeline: renewed.timeline, operation: null });
  });
});

function pausedAt(phase: RestorePhase) {
  return watched(async (what) => {
    const reached = await t.env.db.prepare('SELECT 1 FROM restores WHERE phase = ? AND verified = 0').bind(phase).first();
    if (reached) throw new Crash(what);
  });
}
