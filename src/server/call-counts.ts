import type { CallKind } from '../contracts/admin';
import { DAY_MS, dayStart } from './backup/snapshots';
import type { Db } from './db/service-db';

// Days of counts kept, today included, as the privacy page says.
export const KEEP_DAYS = 30;
const RANK_DAYS = 7;
const RANKED = 10;

// The first day of the `days` days that end today.
export const firstDay = (days: number, now: number) => dayStart(now) - (days - 1) * DAY_MS;

// A count must never fail the person's call, so a failed write is logged and swallowed here. The FROM accounts clause
// makes an account deleted meanwhile count nothing instead of failing the foreign key.
export async function countCall(db: Db, incarnation: string, kind: CallKind): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO call_counts (incarnation, day, kind, calls) SELECT ?1, ?2, ?3, 1 FROM accounts WHERE incarnation = ?1
         ON CONFLICT (incarnation, day, kind) DO UPDATE SET calls = calls + 1`,
      )
      .bind(incarnation, dayStart(Date.now()), kind)
      .run();
  } catch (error) {
    console.error('call count failed', { kind, error: String(error) });
  }
}

// Counting began when the migration applied, mid-day: that partial day is never shown, so the first day counted is the
// next UTC midnight. The name is the migration's file name.
async function countedSince(db: Db, days: number, now: number) {
  const began = (await db.prepare(`SELECT applied_at FROM migrations WHERE name = '0002_call_counts.sql'`).first<number>('applied_at'))!;
  return Math.max(began % DAY_MS === 0 ? began : dayStart(began) + DAY_MS, firstDay(days, now));
}

// since: the first day counted in full; a day from since to today without a row had no call. null: no such account.
export async function accountCalls(db: Db, id: string, now: number) {
  const account = await db.prepare('SELECT incarnation, created_at FROM accounts WHERE id = ?').bind(id).first<{ incarnation: string; created_at: number }>();
  if (!account) return null;
  const since = Math.max(await countedSince(db, KEEP_DAYS, now), dayStart(account.created_at));
  const { results } = await db
    .prepare('SELECT day, kind, calls FROM call_counts WHERE incarnation = ? AND day >= ? ORDER BY day')
    .bind(account.incarnation, since)
    .all<{ day: number; kind: CallKind; calls: number }>();
  return { since, today: dayStart(now), days: results };
}

// The accounts with the most admitted calls over the last RANK_DAYS days; refused calls are shown beside, not ranked.
export async function topCallers(db: Db, now: number) {
  const since = await countedSince(db, RANK_DAYS, now);
  const { results } = await db
    .prepare(
      `SELECT a.id AS accountId, a.username, SUM(CASE WHEN c.kind = 'refused' THEN 0 ELSE c.calls END) AS calls,
         SUM(CASE WHEN c.kind = 'refused' THEN c.calls ELSE 0 END) AS refused
       FROM call_counts c JOIN accounts a ON a.incarnation = c.incarnation WHERE c.day >= ?
       GROUP BY c.incarnation ORDER BY calls DESC, refused DESC LIMIT ?`,
    )
    .bind(since, RANKED)
    .all<{ accountId: string; username: string; calls: number; refused: number }>();
  return { since, today: dayStart(now), accounts: results };
}
