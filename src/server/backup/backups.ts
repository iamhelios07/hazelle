import type { Alerts } from '../alerts';
import { DAY_MS, type Services } from '../http';
import { recordDeparture } from './departures';
import { freePercent, freshness, type DiskFree, type Freshness } from './freshness';
import { captureGeneration, expireGenerations, generationsDir, namedArchives } from './generation';
import { dayStart, expireSnapshots, staleBaselines, takeBaselines } from './snapshots';

// The daily job, the gate a backup generation holds, and their record in backup_runs (docs/research/docker-port-plan.md
// §10). One job runs at a time.

const HOUR_MS = 60 * 60 * 1000;

type Outcome = { outcome: 'ok' | 'failed'; error: string | null };

export type Backups = {
  // Lifecycle steps, file claims on object writes or share publication, and file sweeps hold off generation capture.
  // A hold waits while a generation is being captured; capture waits for existing holds. Writes naming no files take none. Holds never
  // nest: a capture waiting on the outer one would keep the inner one waiting for ever.
  hold<T>(work: () => Promise<T>): Promise<T>;
  // Runs the daily job unless today's (UTC) generation is already captured or the hour has not come: a failed
  // generation is tried again on the next tick, and a run the process missed while down happens on the first tick
  // after it. A baseline that failed beside a captured generation waits for tomorrow; its failed run raises the alert.
  // Then sends each standing alert to the webhook, at most once a UTC day per condition.
  tick(env: Services, now: number): Promise<void>;
  freshness(env: Services, now: number): Promise<Freshness>;
  daily(env: Services, now: number): Promise<{ snapshots: Outcome; generation: Outcome }>;
  // A job that began after this was asked (one already running is waited out first, since its generation may predate
  // what the asker wants covered) and covers every live account as it is now, not as of today's baseline. A baseline it
  // could not take fails its generation: published, it would name an older baseline for that account.
  fresh(env: Services): Promise<{ snapshots: Outcome; generation: Outcome }>;
  // Records an account's departure (departures.ts), durably, before any of it is destroyed.
  depart(account: string, incarnation: string, at: number): void;
};

export function backups(dataDir: string, hour: number, alerts: Alerts, free: DiskFree = freePercent): Backups {
  let holds = 0;
  let capturing: Promise<void> | null = null;
  let drained: (() => void) | null = null;
  let running: ReturnType<Backups['daily']> | null = null;
  let ticking: Promise<void> | null = null;

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

  const recorded = async (env: Services, kind: string, clock: () => number, work: () => Promise<{ error: string | null; detail: object; generation?: string; gateMs?: number }>): Promise<Outcome> => {
    const begun = clock();
    const id = (await env.db.prepare("INSERT INTO backup_runs (kind, started_at, outcome) VALUES (?, ?, 'running') RETURNING id").bind(kind, begun).first<number>('id'))!;
    let ended: Awaited<ReturnType<typeof work>>;
    try {
      ended = await work();
    } catch (thrown) {
      ended = { error: 'job-failed', detail: { message: String(thrown) } };
    }
    const outcome = ended.error === null ? ('ok' as const) : ('failed' as const);
    await env.db
      .prepare('UPDATE backup_runs SET ended_at = ?, outcome = ?, error = ?, detail = ?, generation = ?, gate_ms = ? WHERE id = ?')
      .bind(clock(), outcome, ended.error, JSON.stringify(ended.detail), ended.generation ?? null, ended.gateMs ?? null, id)
      .run();
    return { outcome, error: ended.error };
  };

  const job = (env: Services, now: number, fresh: boolean) => {
    running ??= (async () => {
      const started = Date.now();
      const clock = () => now + Date.now() - started;
      const snapshots = await recorded(env, 'daily', clock, async () => {
        const { taken, skipped, unchanged, failed } = await takeBaselines(env, await staleBaselines(env, now, fresh ? now + 1 : dayStart(now)));
        const expired = await expireSnapshots(env, now, await namedArchives(dataDir));
        return { error: failed.length ? 'baseline-failed' : null, detail: { taken, skipped, unchanged, failed: failed.length, expired } };
      });
      const generation = await recorded(env, 'generation', clock, async () => {
        if (fresh && snapshots.outcome === 'failed') return { error: 'baseline-failed', detail: {} };
        const { id, gateMs, manifest } = await captureGeneration(env, dataDir, now, clock, exclusive);
        const expired = await expireGenerations(dataDir, now);
        return { error: null, generation: id, gateMs, detail: { accounts: manifest.accounts.length, pictures: manifest.pictures.length, expired } };
      });
      return { snapshots, generation };
    })().finally(() => {
      running = null;
    });
    return running;
  };

  const alert = async (env: Services, now: number) => {
    const day = dayStart(now);
    const failed = await env.db.prepare("SELECT 1 FROM backup_runs WHERE outcome = 'failed' AND started_at >= ?1 AND started_at < ?1 + ?2").bind(day, DAY_MS).first();
    const standing = [...(await freshness(env, dataDir, now, free)).warnings, ...(failed === null ? [] : ['job-failed' as const])];
    for (const condition of standing) await alerts.send(env, condition, now);
  };

  const daily = (env: Services, now: number) => job(env, now, false);

  return {
    hold,
    daily,
    fresh: async (env) => {
      while (running) await running;
      return job(env, Date.now(), true);
    },
    freshness: (env, now) => freshness(env, dataDir, now, free),
    depart: (account, incarnation, at) => recordDeparture(generationsDir(dataDir), { account, incarnation, leftAt: at }),
    // One tick at a time: a second that comes while one runs gets that one, so no alert goes out twice. Today is the
    // UTC day itself, not "from its start on": a run stamped by a clock since put back belongs to no day yet.
    tick: (env, now) =>
      (ticking ??= (async () => {
        if (now - dayStart(now) >= hour * HOUR_MS) {
          const done = await env.db
            .prepare("SELECT 1 FROM backup_runs WHERE kind = 'generation' AND outcome = 'ok' AND started_at >= ?1 AND started_at < ?1 + ?2")
            .bind(dayStart(now), DAY_MS)
            .first();
          if (done === null) await daily(env, now);
        }
        await alert(env, now);
      })().finally(() => {
        ticking = null;
      })),
  };
}
