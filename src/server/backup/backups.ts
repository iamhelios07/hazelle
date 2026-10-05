import type { Services } from '../http';
import { captureGeneration, expireGenerations } from './generation';
import { dayStart, expireSnapshots, staleBaselines, takeBaselines } from './snapshots';

// The daily job, the gate a backup generation holds, and their record in backup_runs (docs/research/docker-port-plan.md
// §10). One job runs at a time.

const HOUR_MS = 60 * 60 * 1000;

type Outcome = { outcome: 'ok' | 'failed'; error: string | null };

export type Backups = {
  // Every lifecycle step (signup, deletion, each phase of a rewind) runs inside a hold: a hold waits while a generation
  // is being captured, and a capture waits for the holds already running. Ordinary writes take no hold. Holds never
  // nest: a capture waiting on the outer one would keep the inner one waiting for ever.
  hold<T>(work: () => Promise<T>): Promise<T>;
  // Runs the daily job unless today's (UTC) generation is already captured or the hour has not come: a failed
  // generation is tried again on the next tick, and a run the process missed while down happens on the first tick
  // after it. A baseline that failed beside a captured generation waits for tomorrow; its failed run raises the alert.
  tick(env: Services, now: number): Promise<void>;
  daily(env: Services, now: number): Promise<{ snapshots: Outcome; generation: Outcome }>;
};

export function backups(dataDir: string, hour: number): Backups {
  let holds = 0;
  let capturing: Promise<void> | null = null;
  let drained: (() => void) | null = null;
  let running: ReturnType<Backups['daily']> | null = null;

  const hold = async <T>(work: () => Promise<T>): Promise<T> => {
    while (capturing) await capturing;
    holds++;
    try {
      return await work();
    } finally {
      if (--holds === 0) drained?.();
    }
  };

  const exclusive = async <T>(work: () => Promise<T>) => {
    const asked = Date.now();
    let release = () => {};
    capturing = new Promise((resolve) => (release = resolve));
    try {
      if (holds > 0) await new Promise<void>((resolve) => (drained = resolve));
      drained = null;
      const value = await work();
      return { value, gateMs: Date.now() - asked };
    } finally {
      capturing = null;
      release();
    }
  };

  // detail and the outcome go on the run's row when it ends; a throw is a failed run.
  const recorded = async (env: Services, kind: string, now: number, work: () => Promise<{ error: string | null; detail: object; generation?: string; gateMs?: number }>): Promise<Outcome> => {
    const begun = Date.now();
    const id = (await env.db.prepare("INSERT INTO backup_runs (kind, started_at, outcome) VALUES (?, ?, 'running') RETURNING id").bind(kind, now).first<number>('id'))!;
    let ended: Awaited<ReturnType<typeof work>>;
    try {
      ended = await work();
    } catch (thrown) {
      ended = { error: 'job-failed', detail: { message: String(thrown) } };
    }
    const outcome = ended.error === null ? ('ok' as const) : ('failed' as const);
    await env.db
      .prepare('UPDATE backup_runs SET ended_at = ?, outcome = ?, error = ?, detail = ?, generation = ?, gate_ms = ? WHERE id = ?')
      .bind(now + Date.now() - begun, outcome, ended.error, JSON.stringify(ended.detail), ended.generation ?? null, ended.gateMs ?? null, id)
      .run();
    return { outcome, error: ended.error };
  };

  const daily = (env: Services, now: number) => {
    running ??= (async () => {
      const snapshots = await recorded(env, 'daily', now, async () => {
        const { taken, failed } = await takeBaselines(env, await staleBaselines(env, ['active'], dayStart(now)));
        const expired = await expireSnapshots(env, dataDir, now);
        return { error: failed.length ? 'baseline-failed' : null, detail: { taken, failed: failed.length, expired } };
      });
      const generation = await recorded(env, 'generation', now, async () => {
        const { id, gateMs, manifest } = await captureGeneration(env, dataDir, now, exclusive);
        const expired = await expireGenerations(dataDir, now);
        return { error: null, generation: id, gateMs, detail: { accounts: manifest.accounts.length, pictures: manifest.pictures.length, expired } };
      });
      return { snapshots, generation };
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    hold,
    daily,
    tick: async (env, now) => {
      if (running || now - dayStart(now) < hour * HOUR_MS) return;
      const done = await env.db
        .prepare("SELECT 1 FROM backup_runs WHERE kind = 'generation' AND outcome = 'ok' AND started_at >= ?")
        .bind(dayStart(now))
        .first();
      if (done === null) await daily(env, now);
    },
  };
}
