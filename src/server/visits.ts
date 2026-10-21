import { createHmac, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { VisitDay } from '../contracts/admin';
import type { Db } from './db/service-db';
import { transaction } from './db/transaction';
import { DAY_MS } from './http';

const KST = 9 * 60 * 60 * 1000;
export const visitDay = (at: number) => Math.floor((at + KST) / DAY_MS) * DAY_MS - KST;

export type PageVisit = { kind: 'visit'; address: string; agent: string };
export type FrontendMessage = 'listening' | 'draining' | 'closed' | PageVisit;

// Only the API process owns these rows. The public worker sends HTML answers over IPC, never through a public route.
export function openVisits(db: DatabaseSync, clock: () => number = Date.now) {
  const close = () => transaction(db, () => {
    db.prepare('DELETE FROM visit_hashes WHERE day < ?').run(visitDay(clock()));
    db.prepare('DELETE FROM visit_keys WHERE day < ?').run(visitDay(clock()));
  });
  close();
  return {
    close,
    page: ({ address, agent }: PageVisit) => {
      if (/bot|crawl|spider|slurp|preview/i.test(agent)) return;
      close();
      const day = visitDay(clock());
      transaction(db, () => {
        db.prepare('INSERT INTO visit_keys (day, key) VALUES (?, ?) ON CONFLICT DO NOTHING').run(day, randomBytes(32));
        const { key } = db.prepare('SELECT key FROM visit_keys WHERE day = ?').get(day) as { key: Uint8Array };
        const hash = createHmac('sha256', key).update(JSON.stringify([address, agent])).digest('hex');
        const added = db.prepare('INSERT INTO visit_hashes (day, hash) VALUES (?, ?) ON CONFLICT DO NOTHING').run(day, hash);
        db.prepare('INSERT INTO visit_days (day, visitors) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET visitors = visitors + excluded.visitors').run(day, Number(added.changes));
      });
    },
  };
}

export async function readVisits(db: Db, now = Date.now()): Promise<VisitDay[]> {
  const today = visitDay(now);
  const { results } = await db.prepare('SELECT day, visitors, guests, accounts, converted FROM visit_days WHERE day >= ? AND day <= ? ORDER BY day DESC').bind(today - 13 * DAY_MS, today).all<VisitDay>();
  const days = new Map(results.map((row) => [row.day, row]));
  return Array.from({ length: 14 }, (_, index) => {
    const day = today - index * DAY_MS;
    return days.get(day) ?? { day, visitors: 0, guests: 0, accounts: 0, converted: 0 };
  });
}
