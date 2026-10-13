import { rm } from 'node:fs/promises';
import { CURRENT_BASELINE, RETENTION_MS, snapshotPath, TAKES_BASELINE } from '../db/account-db';
import type { Services } from '../http';

// The daily baselines and the retention of every snapshot (docs/research/docker-port-plan.md §10.1). Day boundaries
// are UTC. Work goes one account at a time with a yield between, so the event loop keeps serving requests.

export const DAY_MS = 24 * 60 * 60 * 1000;

// The pin rule, over a snapshots row aliased `s` and the time `now` (a bind or literal): an operation pins its
// checkpoint and target until it ends and for RETENTION_MS after, whichever way it ended: a finished rewind's undo lives
// that long, and a cancelled or failed one stays recoverable by hand. Retention and every backup generation read this
// one rule.
export const PINNED = (s: string, now: string) =>
  `EXISTS (SELECT 1 FROM restores r WHERE r.incarnation = ${s}.incarnation AND ${s}.id IN (r.checkpoint, r.target)
     AND (r.ended_at IS NULL OR r.ended_at > ${now} - ${RETENTION_MS}))`;

export const dayStart = (now: number) => now - (now % DAY_MS);
export const pass = () => new Promise<void>((resolve) => setImmediate(resolve));

// The accounts that take a baseline now (TAKES_BASELINE) whose current baseline (CURRENT_BASELINE) is absent or older
// than `before`, and when restoring older than today (UTC) at least: one restoring before its checkpoint is restored
// from its baseline should the operation be cut off. A `before` past `now` selects every one. Freshness is judged among baselines only: a young checkpoint holds an
// operation's undo, not the account as it is now. An account unchanged since an old current baseline stays selected
// every day; its take finds it unchanged and copies nothing.
export async function staleBaselines(env: Services, now: number, before: number): Promise<string[]> {
  const { results } = await env.db
    .prepare(
      `SELECT incarnation FROM accounts a
       WHERE ${TAKES_BASELINE('a')}
         AND COALESCE((${CURRENT_BASELINE('taken_at', 'a', '?1')}), -1) < CASE a.state WHEN 'active' THEN ?2 ELSE MAX(?2, ?3) END
       ORDER BY incarnation`,
    )
    .bind(now, before, dayStart(now))
    .all<{ incarnation: string }>();
  return results.map(({ incarnation }) => incarnation);
}

// skipped: accounts that stopped taking a baseline between their selection and their turn. unchanged: those whose file
// still holds what their current baseline holds. failed: those whose snapshot threw.
export async function takeBaselines(env: Services, incarnations: string[]): Promise<{ taken: number; skipped: number; unchanged: number; failed: string[] }> {
  let taken = 0;
  let skipped = 0;
  let unchanged = 0;
  const failed: string[] = [];
  for (const incarnation of incarnations) {
    try {
      const outcome = await env.stores.snapshot(incarnation, 'baseline');
      if ('taken' in outcome) taken++;
      else if ('unchanged' in outcome) unchanged++;
      else skipped++;
    } catch {
      failed.push(incarnation);
    }
    await pass();
  }
  return { taken, skipped, unchanged, failed };
}

// A snapshot goes once it is RETENTION_MS old, unless it is pinned (PINNED), it is a live account's floor: its newest
// baseline RETENTION_MS old or older, the account as it was when the window began, or a delta names it as its base.
// Baselines are taken only on days the account changed, so a time inside the window may land on one from before it;
// the floor is also an unchanged account's only copy. A base goes on a later pass, once its last delta has gone.
// A deleted account has no restores and no row, so every snapshot of it goes at RETENTION_MS from its taking, which is
// within RETENTION_MS of the deletion. The row goes before the file; a file left by a crash between has no row, and the
// hourly reconciliation removes it.
export async function expireSnapshots(env: Services, dataDir: string, now: number): Promise<number> {
  const { results } = await env.db
    .prepare(
      `SELECT id, incarnation FROM snapshots s
       WHERE taken_at <= ?1 - ${RETENTION_MS}
         AND NOT ${PINNED('s', '?1')}
         AND NOT EXISTS (SELECT 1 FROM snapshots d WHERE d.incarnation = s.incarnation AND d.base = s.id)
         AND NOT (kind = 'baseline' AND EXISTS (SELECT 1 FROM accounts WHERE incarnation = s.incarnation)
           AND id = (SELECT id FROM snapshots WHERE incarnation = s.incarnation AND kind = 'baseline' AND taken_at <= ?1 - ${RETENTION_MS}
             ORDER BY taken_at DESC, id DESC LIMIT 1))
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
