import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountPath, snapshotFor } from '../db/account-db';
import type { Db, Statement } from '../db/service-db';
import { fakeS3 } from '../files/fake-s3';
import { r2Bucket } from '../files/r2-bucket';
import { diskBucket } from '../files/disk-bucket';
import { snapshotKey } from '../files/bucket';
import { DAY_MS } from '../http';
import { sessionCookie, signupBody, testApp } from '../testing';
import { captureGeneration, generationsDir, listGenerations, readManifest } from './generation';
import { dayStart, expireSnapshots } from './snapshots';

const POINT = {
  oldest: '1-000000000000',
  newest: '1-000000000001',
  undo: '1-000000000002',
  openTarget: '1-000000000003',
  staleUndo: '1-000000000004',
  cancelled: '1-000000000005',
  failed: '1-000000000006',
  young: '1-000000000007',
  goneOnly: '1-000000000008',
  goneYoung: '1-000000000009',
  base: '1-00000000000a',
  delta: '1-00000000000b',
};

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 100').run();
});

const HOUR_MS = 60 * 60 * 1000;

async function signedUp(username: string) {
  const body = signupBody(username);
  sessionCookie(await t.post('signup', body));
  return (await t.env.db.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(body.accountId).first<string>('incarnation'))!;
}

// The job as the process's hourly tick runs it, with the stores' clock at the same time.
const tickAt = (at: number) => {
  t.clock.now = () => at;
  return t.env.backups.tick(t.env, at);
};
const written = async (incarnation: string, body: string) => {
  const timeline = (await t.env.db.prepare('SELECT timeline FROM accounts WHERE incarnation = ?').bind(incarnation).first<string>('timeline'))!;
  const write = { id: crypto.randomUUID(), kind: 'chat', parent: null, body, baseRev: null };
  expect(await t.stores.getByName(incarnation).batch(incarnation, timeline, [write], null)).toMatchObject({ revs: [expect.any(Number)] });
};
const baselines = (incarnation: string) =>
  t.env.db.prepare("SELECT taken_at AS takenAt FROM snapshots WHERE incarnation = ? AND kind = 'baseline' ORDER BY taken_at").bind(incarnation).all<{ takenAt: number }>();

describe('the daily job', () => {
  it('takes a baseline only on a day after the account changed, through a day run twice and a clock that jumps back across the hour', async () => {
    const incarnation = await signedUp('jin');
    const first = dayStart(Date.now()) - 10 * DAY_MS + 3 * HOUR_MS;
    for (let day = 0; day < 10; day++) {
      const at = first + day * DAY_MS;
      await tickAt(at - 60_000);
      await tickAt(at);
      await tickAt(at + 30 * 60_000);
      await tickAt(at - HOUR_MS + 1);
      if (day === 3 || day === 7) await written(incarnation, `day ${day}`);
    }
    expect((await baselines(incarnation)).results.map(({ takenAt }) => (takenAt - first) / DAY_MS)).toEqual([0, 4, 8]);
    const runs = t.env.db.prepare(
      "SELECT COUNT(*) AS runs, SUM(json_extract(detail, '$.taken')) AS taken, SUM(json_extract(detail, '$.unchanged')) AS unchanged FROM backup_runs WHERE kind = 'daily' AND outcome = 'ok'",
    );
    expect(await runs.first()).toEqual({ runs: 10, taken: 3, unchanged: 7 });
    expect(await snapshotFor(t.env.files, t.env.db, incarnation, first + 6 * DAY_MS)).toMatchObject({ takenAt: first + 4 * DAY_MS });
    // 10 real generations: past 5 s when the whole suite runs beside it.
  }, 30_000);

  it('answers a time inside the window from the baseline of an account unchanged for longer than it, and keeps that baseline as the floor once the account changes', async () => {
    const incarnation = await signedUp('jin');
    const day = (n: number) => dayStart(Date.now()) - 17 * DAY_MS + 3 * HOUR_MS + n * DAY_MS;
    await t.daily(day(0));
    await written(incarnation, 'before the idle stretch');
    await t.daily(day(1));
    await t.daily(day(6));
    await t.daily(day(13));
    // day(0), the signup's baseline, stays as the base of day(1)'s delta.
    expect((await baselines(incarnation)).results).toEqual([{ takenAt: day(0) }, { takenAt: day(1) }]);
    expect(await snapshotFor(t.env.files, t.env.db, incarnation, day(10))).toMatchObject({ takenAt: day(1) });
    await written(incarnation, 'after it');
    await t.daily(day(14));
    await t.daily(day(17));
    expect((await baselines(incarnation)).results).toEqual([{ takenAt: day(0) }, { takenAt: day(1) }, { takenAt: day(14) }]);
    expect(await snapshotFor(t.env.files, t.env.db, incarnation, day(12))).toMatchObject({ takenAt: day(1) });
  });

  it('captures the day again after the clock jumps back across midnight, past a run and a baseline stamped in the future', async () => {
    const incarnation = await signedUp('jin');
    const today = dayStart(Date.now()) + 4 * HOUR_MS;
    await tickAt(today + 2 * DAY_MS);
    await tickAt(today);
    expect((await baselines(incarnation)).results.map(({ takenAt }) => takenAt)).toEqual([today, today + 2 * DAY_MS]);
    const generation = (await listGenerations(t.dir)).find(({ capturedAt }) => capturedAt === today)!;
    const { accounts } = (await readManifest(join(t.dir, 'backup', generation.id)))!;
    expect(accounts[0]!.baseline).toMatch(new RegExp(`^${today}-`));
  });

  it('takes a baseline beside a checkpoint younger than a day, and records a run that failed an account, then tries again', async () => {
    const live = await signedUp('jin');
    const lost = await signedUp('lost');
    const at = dayStart(Date.now()) + 3 * HOUR_MS;
    await t.env.db
      .prepare("INSERT INTO snapshots (id, incarnation, kind, operation, taken_at, rev, bytes, expanded, sha256) VALUES (?, ?, 'checkpoint', 1, ?, 0, 1, 1, 'x')")
      .bind(POINT.young, live, at - HOUR_MS)
      .run();
    rmSync(accountPath(t.dir, lost));
    t.restartProcess();
    await tickAt(at);
    expect((await baselines(live)).results).toEqual([{ takenAt: at }]);
    expect(await t.env.db.prepare("SELECT outcome, error, json_extract(detail, '$.failed') AS failed FROM backup_runs WHERE kind = 'daily'").first()).toEqual({ outcome: 'failed', error: 'baseline-failed', failed: 1 });
    // Its file gone, the account has no baseline a generation could restore it from, so the generation fails too.
    expect(await t.env.db.prepare("SELECT outcome, error FROM backup_runs WHERE kind = 'generation'").first()).toEqual({ outcome: 'failed', error: 'job-failed' });
    await tickAt(at + HOUR_MS);
    expect(await t.env.db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE outcome = 'failed' AND kind = 'daily'").first('n')).toBe(2);
    expect((await baselines(live)).results).toHaveLength(1);
  });
});

describe('retention', () => {
  it('keeps as the floor a baseline from before a rewind, which a time inside the window from before the rewind still lands on', async () => {
    const incarnation = await signedUp('jin');
    const now = Date.now();
    t.clock.now = () => now - 11 * DAY_MS;
    const floor = ((await t.stores.snapshot(incarnation)) as { taken: string }).taken;
    await written(incarnation, 'then rewound away');
    t.clock.now = () => now - 4 * DAY_MS;
    const target = ((await t.stores.snapshot(incarnation)) as { taken: string }).taken;
    await t.env.db
      .prepare("INSERT INTO restores (incarnation, report_id, at, timeline, target, phase, verified, created_at, updated_at, ended_at) VALUES (?1, 1, ?2, 'new', ?3, 'done', 1, ?4, ?4, ?4)")
      .bind(incarnation, now - 4 * DAY_MS, target, now - 2 * DAY_MS)
      .run();
    await t.env.db.prepare("UPDATE accounts SET timeline = 'new' WHERE incarnation = ?").bind(incarnation).run();
    t.clock.now = () => now - DAY_MS;
    expect(await t.stores.snapshot(incarnation)).toEqual({ taken: expect.any(String) });
    expect(await expireSnapshots(t.env, now)).toBe(0);
    expect(await snapshotFor(t.env.files, t.env.db, incarnation, now - 5 * DAY_MS)).toEqual({ id: floor, takenAt: now - 11 * DAY_MS });
  });

  it('reclaims a snapshot file whose expiry committed before the process stopped without deleting the live floor', async () => {
    const incarnation = await signedUp('jin');
    const now = Date.now();
    // Older than RETENTION_MS before the floor, so the floor is whole and names no base.
    t.clock.now = () => now - 17 * DAY_MS;
    const old = ((await t.stores.snapshot(incarnation)) as { taken: string }).taken;
    await written(incarnation, 'floor');
    t.clock.now = () => now - 9 * DAY_MS;
    const floor = ((await t.stores.snapshot(incarnation)) as { taken: string }).taken;
    const stopping = (real: Statement): Statement => ({
      ...real,
      bind: (...values) => stopping(real.bind(...values)),
      run: async () => {
        await real.run();
        throw new Error('stopped after expiry commit');
      },
    });
    const db: Db = { ...t.env.db, prepare: (sql) => sql.startsWith('DELETE FROM snapshots') ? stopping(t.env.db.prepare(sql)) : t.env.db.prepare(sql) };
    await expect(expireSnapshots({ ...t.env, db }, now)).rejects.toThrow('stopped after expiry commit');
    expect(await t.env.db.prepare('SELECT id FROM snapshots WHERE id = ?').bind(old).first()).toBeNull();
    expect(existsSync(diskBucket(t.dir).path(snapshotKey(incarnation, old)))).toBe(true);
    t.restartProcess();
    expect(await expireSnapshots(t.env, now)).toBe(0);
    expect((await t.reconcile(now + 61 * 60_000)).removed).toContain(`snapshots/${incarnation}/${old}.sqlite.gz`);
    expect(existsSync(diskBucket(t.dir).path(snapshotKey(incarnation, floor)))).toBe(true);
    expect(await snapshotFor(t.env.files, t.env.db, incarnation, now - DAY_MS)).toEqual({ id: floor, takenAt: now - 9 * DAY_MS });
  });

  it('lets a snapshot go at 7 days unless an operation pins it (open, or ended under 7 days ago however it ended) or it is a live account’s floor; a deleted account keeps none past 7 days', async () => {
    const live = await signedUp('jin');
    const gone = 'f'.repeat(32);
    const now = Date.now();
    const old = now - 8 * DAY_MS;
    const snapshots: [string, string, string, number][] = [
      [POINT.oldest, live, 'baseline', old - DAY_MS],
      [POINT.newest, live, 'baseline', old],
      [POINT.undo, live, 'checkpoint', old],
      [POINT.openTarget, live, 'baseline', old - 2 * DAY_MS],
      [POINT.staleUndo, live, 'checkpoint', old],
      [POINT.cancelled, live, 'checkpoint', old],
      [POINT.failed, live, 'checkpoint', old],
      [POINT.young, live, 'checkpoint', now - DAY_MS],
      [POINT.goneOnly, gone, 'baseline', old],
      [POINT.goneYoung, gone, 'baseline', now - 4 * DAY_MS],
    ];
    for (const [id, incarnation, kind, takenAt] of snapshots) {
      await t.env.db
        .prepare('INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, expanded, sha256, timeline) VALUES (?1, ?2, ?3, ?4, 0, 1, 1, ?5, (SELECT timeline FROM accounts WHERE incarnation = ?2))')
        .bind(id, incarnation, kind, takenAt, 'x')
        .run();
      await t.env.files.put(snapshotKey(incarnation, id), new Uint8Array([120]));
    }
    // updated_at is the latest retry's; only ended_at counts.
    const restore = (phase: string, checkpoint: string | null, target: string | null, endedAt: number | null) =>
      t.env.db
        .prepare('INSERT INTO restores (incarnation, report_id, at, timeline, checkpoint, target, phase, created_at, updated_at, ended_at) VALUES (?, 1, 1, ?, ?, ?, ?, 1, ?, ?)')
        .bind(live, 'x', checkpoint, target, phase, now, endedAt)
        .run();
    await restore('done', POINT.undo, null, now - 4 * DAY_MS);
    await restore('done', POINT.staleUndo, null, now - 8 * DAY_MS);
    await restore('armed', null, POINT.openTarget, null);
    await restore('cancelled', POINT.cancelled, null, now - DAY_MS);
    await restore('failed', POINT.failed, null, now - 8 * DAY_MS);

    expect(await expireSnapshots(t.env, now)).toBe(4);
    const left = (await t.env.db.prepare('SELECT id FROM snapshots ORDER BY id').all<{ id: string }>()).results.map(({ id }) => id);
    expect(left).toEqual([POINT.cancelled, POINT.goneYoung, POINT.newest, POINT.openTarget, POINT.undo, POINT.young].sort());
    for (const [id, incarnation] of snapshots) expect(existsSync(diskBucket(t.dir).path(snapshotKey(incarnation, id)))).toBe(left.includes(id));
    expect(await expireSnapshots(t.env, now + 3 * DAY_MS)).toBe(2);
    expect((await t.env.db.prepare('SELECT id FROM snapshots ORDER BY id').all<{ id: string }>()).results.map(({ id }) => id)).toEqual([POINT.cancelled, POINT.newest, POINT.openTarget, POINT.young].sort());
  });

  it('keeps a base while a delta names it, and lets it go on the pass after its last delta went', async () => {
    const gone = 'f'.repeat(32);
    const now = Date.now();
    const rows: [string, string | null, number][] = [
      [POINT.base, null, now - 10 * DAY_MS],
      [POINT.delta, POINT.base, now - 4 * DAY_MS],
    ];
    for (const [id, base, takenAt] of rows) {
      await t.env.db.prepare("INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, expanded, sha256, base) VALUES (?, ?, 'baseline', ?, 0, 1, 1, 'x', ?)").bind(id, gone, takenAt, base).run();
      await t.env.files.put(snapshotKey(gone, id), new Uint8Array([120]));
    }
    const left = async () => (await t.env.db.prepare('SELECT id FROM snapshots ORDER BY id').all<{ id: string }>()).results.map(({ id }) => id);
    expect(await expireSnapshots(t.env, now)).toBe(0);
    expect(await expireSnapshots(t.env, now + 4 * DAY_MS)).toBe(1);
    expect(await left()).toEqual([POINT.base]);
    expect(await expireSnapshots(t.env, now + 4 * DAY_MS)).toBe(1);
    expect(await left()).toEqual([]);
    expect(existsSync(diskBucket(t.dir).path(snapshotKey(gone, POINT.base)))).toBe(false);
  });
});

it('defers an expired R2 archive for a generation retention, then deletes it from the store', async () => {
  const s3 = await fakeS3();
  const disk = t.env.files;
  t.env.files = r2Bucket(s3.config);
  t.restartProcess();
  try {
    const incarnation = await signedUp('jin');
    const now = Date.now();
    t.clock.now = () => now - 17 * DAY_MS;
    const old = ((await t.stores.snapshot(incarnation)) as { taken: string }).taken;
    const generation = await captureGeneration(t.env, t.dir, t.clock.now(), t.clock.now, async (work) => ({ value: await work(), gateMs: 0 }));
    await written(incarnation, 'floor');
    t.clock.now = () => now - 9 * DAY_MS;
    const floor = ((await t.stores.snapshot(incarnation)) as { taken: string }).taken;
    const key = snapshotKey(incarnation, old);
    await t.env.db.prepare('INSERT INTO snapshot_removals VALUES (?, ?)').bind(key, now - 1).run();
    expect(await expireSnapshots(t.env, now)).toBe(1);
    expect(await t.env.db.prepare('SELECT * FROM snapshot_removals').all()).toMatchObject({ results: [{ key, due_at: now + 7 * DAY_MS }] });
    await t.reconcile(now + 7 * DAY_MS - 1);
    expect(s3.objects.has(key)).toBe(true);
    await t.reconcile(now + 7 * DAY_MS);
    expect(s3.objects.has(key)).toBe(true);
    rmSync(join(generationsDir(t.dir), generation.id), { recursive: true });
    await t.reconcile(now + 7 * DAY_MS + 1);
    expect(s3.objects.has(key)).toBe(false);
    expect(s3.objects.has(snapshotKey(incarnation, floor))).toBe(true);
    expect(await t.env.db.prepare('SELECT * FROM snapshot_removals').all()).toMatchObject({ results: [] });
  } finally {
    t.env.files = disk;
    t.restartProcess();
    await s3.close();
  }
});
