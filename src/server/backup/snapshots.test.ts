import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountPath, snapshotPath } from '../db/account-db';
import { sessionCookie, signupBody, testApp } from '../testing';
import { listGenerations, readManifest } from './generation';
import { DAY_MS, dayStart, expireSnapshots } from './snapshots';

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
    expect(await t.stores.snapshotAt(incarnation, first + 6 * DAY_MS)).toMatchObject({ takenAt: first + 4 * DAY_MS });
    // 10 real generations: past 5 s when the whole suite runs beside it.
  }, 30_000);
});

describe('retention', () => {
  it('lets a snapshot go at 30 days unless an operation pins it (open, or ended under 30 days ago however it ended) or it is a live account’s newest baseline; a deleted account keeps none past 30 days', async () => {
    const live = await signedUp('jin');
    const gone = 'f'.repeat(32);
    const now = Date.now();
    const old = now - 31 * DAY_MS;
    const snapshots: [string, string, string, number][] = [
      ['oldest', live, 'baseline', old - DAY_MS],
      ['newest', live, 'baseline', old],
      ['undo', live, 'checkpoint', old],
      ['open-target', live, 'baseline', old - 2 * DAY_MS],
      ['stale-undo', live, 'checkpoint', old],
      ['cancelled', live, 'checkpoint', old],
      ['failed', live, 'checkpoint', old],
      ['young', live, 'checkpoint', now - DAY_MS],
      ['gone-only', gone, 'baseline', old],
      ['gone-young', gone, 'baseline', now - 10 * DAY_MS],
    ];
    for (const [id, incarnation, kind, takenAt] of snapshots) {
      await t.env.db.prepare('INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, sha256) VALUES (?, ?, ?, ?, 0, 1, ?)').bind(id, incarnation, kind, takenAt, 'x').run();
      mkdirSync(join(t.dir, 'snapshots', incarnation), { recursive: true });
      writeFileSync(snapshotPath(t.dir, incarnation, id), 'x');
    }
    // updated_at is the latest retry's; only ended_at counts.
    const restore = (phase: string, checkpoint: string | null, target: string | null, endedAt: number | null) =>
      t.env.db
        .prepare('INSERT INTO restores (incarnation, report_id, at, timeline, checkpoint, target, phase, created_at, updated_at, ended_at) VALUES (?, 1, 1, ?, ?, ?, ?, 1, ?, ?)')
        .bind(live, 'x', checkpoint, target, phase, now, endedAt)
        .run();
    await restore('done', 'undo', null, now - 10 * DAY_MS);
    await restore('done', 'stale-undo', null, now - 31 * DAY_MS);
    await restore('armed', null, 'open-target', null);
    await restore('cancelled', 'cancelled', null, now - 5 * DAY_MS);
    await restore('failed', 'failed', null, now - 31 * DAY_MS);

    expect(await expireSnapshots(t.env, t.dir, now)).toBe(4);
    const left = (await t.env.db.prepare('SELECT id FROM snapshots ORDER BY id').all<{ id: string }>()).results.map(({ id }) => id);
    expect(left).toEqual(['cancelled', 'gone-young', 'newest', 'open-target', 'undo', 'young']);
    for (const [id, incarnation] of snapshots) expect(existsSync(snapshotPath(t.dir, incarnation, id))).toBe(left.includes(id));
    expect(await expireSnapshots(t.env, t.dir, now + 20 * DAY_MS)).toBe(2);
    expect((await t.env.db.prepare('SELECT id FROM snapshots ORDER BY id').all<{ id: string }>()).results.map(({ id }) => id)).toEqual(['cancelled', 'newest', 'open-target', 'young']);
  });
});
