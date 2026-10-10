import { Hono } from 'hono';
import { PRICE_LISTS, type PriceList, type PriceTier, type Rates } from '../connectors/price-list';
import type { Db } from './db/service-db';
import { fail, isRecord, type AppEnv } from './http';
import type { Upstream } from './relay';
import { requireSession } from './session';

const SOURCE = 'https://models.dev/api.json';
const LISTS = new Set(Object.values(PRICE_LISTS).map((entry) => entry!.list));
// The hourly cron asks every time; the prices are fetched again once they are this old, so about once a day.
const STALE_MS = 23 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
// A fetch is background work the shutdown drain waits for, so it is bounded.
const FETCH_MS = 60 * 1000;

export type PriceRow = Rates & { list: string; model: string };

const rate = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

// A model without an input or output price, or with a tier of another kind than context size, is left out and costs
// 알 수 없음: priced without that tier it would read cheaper than the bill. context_over_200k repeats the tiers.
function ratesOf(cost: unknown): Rates | null {
  if (!isRecord(cost)) return null;
  const input = rate(cost.input);
  const output = rate(cost.output);
  if (input === null || output === null || (cost.tiers !== undefined && !Array.isArray(cost.tiers))) return null;
  const tiers: PriceTier[] = [];
  for (const raw of (cost.tiers ?? []) as unknown[]) {
    if (!isRecord(raw) || !isRecord(raw.tier) || raw.tier.type !== 'context') return null;
    const above = rate(raw.tier.size);
    const tierInput = rate(raw.input);
    const tierOutput = rate(raw.output);
    if (above === null || tierInput === null || tierOutput === null) return null;
    tiers.push({ above, input: tierInput, output: tierOutput, cacheRead: rate(raw.cache_read), cacheWrite: rate(raw.cache_write) });
  }
  return { input, output, cacheRead: rate(cost.cache_read), cacheWrite: rate(cost.cache_write), tiers: tiers.sort((a, b) => a.above - b.above) };
}

// null when the payload is not models.dev's provider map at all.
function priceRows(payload: unknown): PriceRow[] | null {
  if (!isRecord(payload)) return null;
  const rows: PriceRow[] = [];
  for (const list of LISTS) {
    const provider = payload[list];
    if (!isRecord(provider) || !isRecord(provider.models)) continue;
    for (const [model, raw] of Object.entries(provider.models)) {
      const rates = isRecord(raw) ? ratesOf(raw.cost) : null;
      if (rates) rows.push({ list, model, ...rates });
    }
  }
  return rows;
}

// One fetch at a time, claimed through tried_at. A failed fetch keeps the prices already stored.
export async function refreshPrices(db: Db, outbound: Upstream, now = Date.now()): Promise<void> {
  const claimed = await db
    .prepare('UPDATE price_fetch SET tried_at = ?1 WHERE id = 1 AND (fetched_at IS NULL OR fetched_at < ?2) AND (tried_at IS NULL OR tried_at < ?3) RETURNING id')
    .bind(now, now - STALE_MS, now - RETRY_MS)
    .first();
  if (!claimed) return;
  let rows: PriceRow[] | null;
  try {
    const response = await outbound(new URL(SOURCE), { method: 'GET', headers: new Headers(), body: null, redirect: 'manual', signal: AbortSignal.timeout(FETCH_MS) });
    rows = response.ok ? priceRows(await response.json()) : null;
    if (!rows) console.error(`models.dev price list unreadable (status ${response.status})`);
  } catch (error) {
    console.error('models.dev price list fetch failed', error);
    return;
  }
  if (!rows?.length) return;
  await db.batch([
    db.prepare('DELETE FROM prices'),
    db
      .prepare(
        `INSERT INTO prices (list, model, input, output, cache_read, cache_write, tiers)
         SELECT value->>'list', value->>'model', value->>'input', value->>'output', value->>'cacheRead', value->>'cacheWrite', value->'tiers' FROM json_each(?)`,
      )
      .bind(JSON.stringify(rows)),
    db.prepare('UPDATE price_fetch SET fetched_at = ? WHERE id = 1').bind(now),
  ]);
}

type Row = { model: string; input: number; output: number; cache_read: number | null; cache_write: number | null; tiers: string };

// Before the first fetch has landed it answers an empty list and starts one; the hourly cron would otherwise leave every
// cost 알 수 없음 for up to an hour after a deploy.
export const prices = new Hono<AppEnv>().use(requireSession).get('/', async (c) => {
  const list = c.req.query('provider');
  if (!list || !LISTS.has(list)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const fetchedAt = await db.prepare('SELECT fetched_at FROM price_fetch WHERE id = 1').first<number | null>('fetched_at');
  if (fetchedAt === null) {
    c.executionCtx.waitUntil(refreshPrices(db, c.env.outbound));
    return c.json({ fetchedAt: null, models: {} } satisfies PriceList);
  }
  const etag = `"${fetchedAt}"`;
  const headers = { etag, 'cache-control': 'private, no-cache' };
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
  const { results } = await db.prepare('SELECT model, input, output, cache_read, cache_write, tiers FROM prices WHERE list = ?').bind(list).all<Row>();
  const models = Object.fromEntries(
    results.map((row) => [row.model, { input: row.input, output: row.output, cacheRead: row.cache_read, cacheWrite: row.cache_write, tiers: JSON.parse(row.tiers) as PriceTier[] }]),
  );
  return c.json({ fetchedAt, models } satisfies PriceList, 200, headers);
});
