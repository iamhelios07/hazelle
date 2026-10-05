import type { Services } from '../http';
import { dayStart, expireSnapshots, staleBaselines, takeBaselines } from './snapshots';

// The daily job and its record in backup_runs (docs/research/docker-port-plan.md §10). One job runs at a time.

const HOUR_MS = 60 * 60 * 1000;

export type Backups = {
  // Runs the daily job unless it already ran today (UTC) or the hour has not come; a failed run is tried again on the
  // next tick, and a run the process missed while down happens on the first tick after it.
  tick(env: Services, now: number): Promise<void>;
  daily(env: Services, now: number): Promise<{ outcome: 'ok' | 'failed'; error: string | null }>;
};

export function backups(dataDir: string, hour: number): Backups {
  let running: Promise<{ outcome: 'ok' | 'failed'; error: string | null }> | null = null;

  const daily = (env: Services, now: number) => {
    running ??= (async () => {
      const db = env.db;
      const begun = Date.now();
      const id = (await db.prepare("INSERT INTO backup_runs (kind, started_at, outcome) VALUES ('daily', ?, 'running') RETURNING id").bind(now).first<number>('id'))!;
      let error: string | null = null;
      let detail: Record<string, unknown> = {};
      try {
        const { taken, failed } = await takeBaselines(env, await staleBaselines(env, ['active'], dayStart(now)));
        const expired = await expireSnapshots(env, dataDir, now);
        detail = { taken, failed: failed.length, expired };
        if (failed.length) error = 'baseline-failed';
      } catch (thrown) {
        error = 'job-failed';
        detail = { ...detail, message: String(thrown) };
      }
      const outcome = error === null ? ('ok' as const) : ('failed' as const);
      await db
        .prepare('UPDATE backup_runs SET ended_at = ?, outcome = ?, error = ?, detail = ? WHERE id = ?')
        .bind(now + Date.now() - begun, outcome, error, JSON.stringify(detail), id)
        .run();
      return { outcome, error };
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    daily,
    tick: async (env, now) => {
      if (running || now - dayStart(now) < hour * HOUR_MS) return;
      const done = await env.db
        .prepare("SELECT 1 FROM backup_runs WHERE kind = 'daily' AND outcome = 'ok' AND started_at >= ?")
        .bind(dayStart(now))
        .first();
      if (done === null) await daily(env, now);
    },
  };
}
