import { rm } from 'node:fs/promises';
import { RETENTION_MS, snapshotPath } from '../db/account-db';
import type { Services } from '../http';

// The daily baselines and the retention of every snapshot (docs/research/docker-port-plan.md §10.1). Day boundaries
// are UTC. Work goes one account at a time with a yield between, so the event loop keeps serving requests.

export const DAY_MS = 24 * 60 * 60 * 1000;

// The pin rule, over a snapshots row aliased `s` and the time `now` (a bind or literal): an operation pins its
// checkpoint and target until it ends and for 30 days after, whichever way it ended: a finished rewind's undo lives
// that long, and a cancelled or failed one stays recoverable by hand. Retention and every backup generation read this
// one rule.
export const PINNED = (s: string, now: string) =>
  `EXISTS (SELECT 1 FROM restores r WHERE r.incarnation = ${s}.incarnation AND ${s}.id IN (r.checkpoint, r.target)
     AND (r.ended_at IS NULL OR r.ended_at > ${now} - ${RETENTION_MS}))`;

export const dayStart = (now: number) => now - (now % DAY_MS);
export const pass = () => new Promise<void>((resolve) => setImmediate(resolve));

// The accounts whose newest baseline is absent, older than `before`, or older than the last rewind finished on them,
// among those in `states`. Freshness is judged among baselines only: a young checkpoint holds an operation's undo, not
// the account as it is now.
export async function staleBaselines(env: Services, states: string[], before: number): Promise<string[]> {
  const { results } = await env.db
    .prepare(
      `SELECT incarnation FROM accounts a
       WHERE state IN (SELECT value FROM json_each(?1))
         AND COALESCE((SELECT MAX(taken_at) FROM snapshots WHERE incarnation = a.incarnation AND kind = 'baseline'), -1)
           < MAX(?2, COALESCE((SELECT MAX(ended_at) FROM restores WHERE incarnation = a.incarnation AND phase = 'done'), -1))
       ORDER BY incarnation`,
    )
    .bind(JSON.stringify(states), before)
    .all<{ incarnation: string }>();
  return results.map(({ incarnation }) => incarnation);
}

// failed: the accounts whose snapshot threw; the others are taken.
export async function takeBaselines(env: Services, incarnations: string[]): Promise<{ taken: number; failed: string[] }> {
  let taken = 0;
  const failed: string[] = [];
  for (const incarnation of incarnations) {
    try {
      await env.stores.snapshot(incarnation, 'baseline');
      taken++;
    } catch {
      failed.push(incarnation);
    }
    await pass();
  }
  return { taken, failed };
}

// A snapshot goes once it is 30 days old, unless it is pinned (PINNED) or it is a live account's newest baseline,
// kept whatever its age so an unchanged account never loses its only copy.
// A deleted account has no restores and no row, so every snapshot of it goes at 30 days from its taking, which is
// within 30 days of the deletion. The row goes before the file; a file left by a crash between has no row, and the
// hourly reconciliation removes it.
export async function expireSnapshots(env: Services, dataDir: string, now: number): Promise<number> {
  const { results } = await env.db
    .prepare(
      `SELECT id, incarnation FROM snapshots s
       WHERE taken_at <= ?1 - ${RETENTION_MS}
         AND NOT ${PINNED('s', '?1')}
         AND NOT (kind = 'baseline' AND EXISTS (SELECT 1 FROM accounts WHERE incarnation = s.incarnation)
           AND id = (SELECT id FROM snapshots WHERE incarnation = s.incarnation AND kind = 'baseline' ORDER BY taken_at DESC, id DESC LIMIT 1))
       ORDER BY incarnation`,
    )
    .bind(now)
    .all<{ id: string; incarnation: string }>();
  for (const { id, incarnation } of results) {
    await env.db.prepare('DELETE FROM snapshots WHERE id = ?').bind(id).run();
    await rm(snapshotPath(dataDir, incarnation, id), { force: true });
    await pass();
  }
  return results.length;
}
