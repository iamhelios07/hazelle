import type { Services } from '../http';
import { freshness, type Freshness } from './freshness';
import { captureGeneration, expireGenerations } from './generation';
import { DAY_MS, dayStart, expireSnapshots, staleBaselines, takeBaselines } from './snapshots';

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
  // Then sends each standing alert to the webhook, at most once a UTC day per condition.
  tick(env: Services, now: number): Promise<void>;
  freshness(env: Services, now: number): Promise<Freshness>;
  daily(env: Services, now: number): Promise<{ snapshots: Outcome; generation: Outcome }>;
  // A daily job that began after this was asked: one already running is waited out first, since its generation may
  // predate what the asker wants covered.
  fresh(env: Services): Promise<{ snapshots: Outcome; generation: Outcome }>;
};

const ALERTS: Record<string, string> = {
  'backup-stale': '백업이 36시간 넘게 없음',
  'disk-full': '디스크 80% 초과',
  'job-failed': '오늘 백업 작업 실패',
};

// webhook: a Discord- or Slack-compatible URL, or null for none.
export function backups(dataDir: string, hour: number, webhook: string | null): Backups {
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
      const started = Date.now();
      const snapshots = await recorded(env, 'daily', now, async () => {
        const { taken, skipped, unchanged, failed } = await takeBaselines(env, await staleBaselines(env, now, dayStart(now)));
        const expired = await expireSnapshots(env, dataDir, now);
        return { error: failed.length ? 'baseline-failed' : null, detail: { taken, skipped, unchanged, failed: failed.length, expired } };
      });
      const generation = await recorded(env, 'generation', now, async () => {
        const { id, gateMs, manifest } = await captureGeneration(env, dataDir, now, () => now + Date.now() - started, exclusive);
        const expired = await expireGenerations(dataDir, now);
        return { error: null, generation: id, gateMs, detail: { accounts: manifest.accounts.length, pictures: manifest.pictures.length, expired } };
      });
      return { snapshots, generation };
    })().finally(() => {
      running = null;
    });
    return running;
  };

  // A send that fails is not recorded, so the next tick tries it again.
  const alert = async (env: Services, now: number) => {
    if (webhook === null) return;
    const day = dayStart(now);
    const failed = await env.db.prepare("SELECT 1 FROM backup_runs WHERE outcome = 'failed' AND started_at >= ?1 AND started_at < ?1 + ?2").bind(day, DAY_MS).first();
    const standing = [...(await freshness(env, dataDir, now)).warnings, ...(failed === null ? [] : ['job-failed'])];
    for (const condition of standing) {
      if ((await env.db.prepare('SELECT 1 FROM alerts_sent WHERE condition = ? AND day = ?').bind(condition, day).first()) !== null) continue;
      const text = `[Hazelle] ${ALERTS[condition]}`;
      const sent = await env
        .outbound(new URL(webhook), {
          method: 'POST',
          headers: new Headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ content: text, text }),
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        })
        .then((response) => response.ok, () => false);
      if (sent) await env.db.prepare('INSERT INTO alerts_sent (condition, day) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(condition, day).run();
    }
  };

  return {
    hold,
    daily,
    fresh: async (env) => {
      while (running) await running;
      return daily(env, Date.now());
    },
    freshness: (env, now) => freshness(env, dataDir, now),
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
