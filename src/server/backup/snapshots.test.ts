import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountPath, snapshotPath } from '../db/account-db';
import { sessionCookie, signupBody, testApp } from '../testing';
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
const baselines = (incarnation: string) =>
  t.env.db.prepare("SELECT taken_at AS takenAt FROM snapshots WHERE incarnation = ? AND kind = 'baseline' ORDER BY taken_at").bind(incarnation).all<{ takenAt: number }>();

describe('the daily job', () => {
  it('keeps one current baseline a day for an unchanged account through missed days, a day run twice and a clock that jumps back across the hour', async () => {
    const incarnation = await signedUp('jin');
    const first = dayStart(Date.now()) - 32 * DAY_MS + 3 * HOUR_MS;
    for (let day = 0; day < 32; day++) {
      if (day === 5 || day === 6) continue;
      const at = first + day * DAY_MS;
      await tickAt(at - 60_000);
      await tickAt(at);
      await tickAt(at + 30 * 60_000);
      await tickAt(at - HOUR_MS + 1);
    }
    const kept = (await baselines(incarnation)).results.map(({ takenAt }) => (takenAt - first) / DAY_MS);
    expect(kept).toEqual([2, 3, 4, ...Array.from({ length: 25 }, (_, index) => index + 7)]);
    expect(await t.env.db.prepare("SELECT COUNT(*) AS n FROM backup_runs WHERE kind = 'daily' AND outcome = 'ok'").first('n')).toBe(30);
    expect(await t.stores.snapshotAt(incarnation, first + 6 * DAY_MS)).toMatchObject({ takenAt: first + 4 * DAY_MS });
  });

  it('takes a baseline beside a checkpoint younger than a day, and records a run that failed an account, then tries again', async () => {
    const live = await signedUp('jin');
    const lost = await signedUp('lost');
    const at = dayStart(Date.now()) + 3 * HOUR_MS;
    await t.env.db
      .prepare("INSERT INTO snapshots (id, incarnation, kind, operation, taken_at, bytes, sha256) VALUES ('young', ?, 'checkpoint', 1, ?, 1, 'x')")
      .bind(live, at - HOUR_MS)
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
  it('lets a snapshot go at 30 days unless an operation pins it or it is a live account’s newest baseline; a deleted account keeps none past 30 days', async () => {
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
      ['young', live, 'checkpoint', now - DAY_MS],
      ['gone-only', gone, 'baseline', old],
      ['gone-young', gone, 'baseline', now - 10 * DAY_MS],
    ];
    for (const [id, incarnation, kind, takenAt] of snapshots) {
      await t.env.db.prepare('INSERT INTO snapshots (id, incarnation, kind, taken_at, bytes, sha256) VALUES (?, ?, ?, ?, 1, ?)').bind(id, incarnation, kind, takenAt, 'x').run();
      mkdirSync(join(t.dir, 'snapshots', incarnation), { recursive: true });
      writeFileSync(snapshotPath(t.dir, incarnation, id), 'x');
    }
    const restore = (phase: string, checkpoint: string | null, target: string | null, updatedAt: number) =>
      t.env.db
        .prepare('INSERT INTO restores (incarnation, report_id, at, timeline, checkpoint, target, phase, created_at, updated_at) VALUES (?, 1, 1, ?, ?, ?, ?, 1, ?)')
        .bind(live, 'x', checkpoint, target, phase, updatedAt)
        .run();
    await restore('done', 'undo', null, now - 10 * DAY_MS);
    await restore('done', 'stale-undo', null, now - 31 * DAY_MS);
    await restore('armed', null, 'open-target', now - 40 * DAY_MS);

    expect(await expireSnapshots(t.env, t.dir, now)).toBe(3);
    const left = (await t.env.db.prepare('SELECT id FROM snapshots ORDER BY id').all<{ id: string }>()).results.map(({ id }) => id);
    expect(left).toEqual(['gone-young', 'newest', 'open-target', 'undo', 'young']);
    for (const [id, incarnation] of snapshots) expect(existsSync(snapshotPath(t.dir, incarnation, id))).toBe(left.includes(id));
    expect(await expireSnapshots(t.env, t.dir, now + 20 * DAY_MS)).toBe(2);
    expect((await t.env.db.prepare('SELECT id FROM snapshots ORDER BY id').all<{ id: string }>()).results.map(({ id }) => id)).toEqual(['newest', 'open-target', 'young']);
  });
});
