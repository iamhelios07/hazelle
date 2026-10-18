import { Hono } from 'hono';
import { MODELS_DEV_LISTS, MODELS_DEV_MODALITIES, type ListedModality, type ListedModel, type ModelsDevList, type PriceTier, type Rates } from '../connectors/models-dev';
import type { Db } from './db/service-db';
import { fail, isRecord, type AppEnv } from './http';
import type { Upstream } from './relay';
import { requireSession } from './session';

const SOURCE = 'https://models.dev/api.json';
const LISTS = new Set(Object.values(MODELS_DEV_LISTS).map((entry) => entry!.list));
// The hourly cron asks every time; the list is fetched again once it is this old, so about once a day.
const STALE_MS = 23 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
// A fetch is background work the shutdown drain waits for, so it is bounded.
const FETCH_MS = 60 * 1000;

// name: models.dev's display name, which 헤이젤 지금 shows (pulse.ts); null where it gives none.
type ListedRow = ListedModel & { list: string; model: string; name: string | null };

const rate = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

// A model without an input or output price, or with a tier of another kind than context size, is left unpriced and costs
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

const WORDS = new Map<unknown, ListedModality>(Object.entries(MODELS_DEV_MODALITIES));
const modalitiesOf = (value: unknown): ListedModality[] | null => (Array.isArray(value) ? value.flatMap((word) => WORDS.get(word) ?? []) : null);

// null when the payload is not models.dev's provider map at all.
function listedRows(payload: unknown): ListedRow[] | null {
  if (!isRecord(payload)) return null;
  const rows: ListedRow[] = [];
  for (const list of LISTS) {
    const provider = payload[list];
    if (!isRecord(provider) || !isRecord(provider.models)) continue;
    for (const [model, raw] of Object.entries(provider.models)) {
      if (!isRecord(raw)) continue;
      const modalities = isRecord(raw.modalities) ? raw.modalities : {};
      const row = { list, model, name: typeof raw.name === 'string' && raw.name ? raw.name : null, price: ratesOf(raw.cost), input: modalitiesOf(modalities.input), output: modalitiesOf(modalities.output) };
      if (row.price || row.input || row.output) rows.push(row);
    }
  }
  return rows;
}

// One fetch at a time, claimed through tried_at. A failed fetch keeps the list already stored.
export async function refreshModelsDev(db: Db, outbound: Upstream, now = Date.now()): Promise<void> {
  const claimed = await db
    .prepare('UPDATE models_dev_fetch SET tried_at = ?1 WHERE id = 1 AND (fetched_at IS NULL OR fetched_at < ?2) AND (tried_at IS NULL OR tried_at < ?3) RETURNING id')
    .bind(now, now - STALE_MS, now - RETRY_MS)
    .first();
  if (!claimed) return;
  let rows: ListedRow[] | null;
  try {
    const response = await outbound(new URL(SOURCE), { method: 'GET', headers: new Headers(), body: null, redirect: 'manual', signal: AbortSignal.timeout(FETCH_MS) });
    rows = response.ok ? listedRows(await response.json()) : null;
    if (!rows) console.error(`models.dev list unreadable (status ${response.status})`);
  } catch (error) {
    console.error('models.dev list fetch failed', error);
    return;
  }
  if (!rows?.length) return;
  await db.batch([
    db.prepare('DELETE FROM models_dev'),
    db
      .prepare(
        `INSERT INTO models_dev (list, model, name, price, input, output)
         SELECT value->>'list', value->>'model', value->>'name', value->>'price', value->>'input', value->>'output' FROM json_each(?)`,
      )
      .bind(JSON.stringify(rows)),
    db.prepare('UPDATE models_dev_fetch SET fetched_at = ? WHERE id = 1').bind(now),
  ]);
}

type Row = { model: string; price: string | null; input: string | null; output: string | null };
const parsed = <T>(json: string | null): T | null => (json === null ? null : (JSON.parse(json) as T));

// Before the first fetch has landed it answers an empty list and starts one; the hourly cron would otherwise leave every
// cost 알 수 없음 for up to an hour after a deploy.
export const modelsDev = new Hono<AppEnv>().use(requireSession).get('/', async (c) => {
  const list = c.req.query('provider');
  if (!list || !LISTS.has(list)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const fetchedAt = await db.prepare('SELECT fetched_at FROM models_dev_fetch WHERE id = 1').first<number | null>('fetched_at');
  if (fetchedAt === null) {
    c.executionCtx.waitUntil(refreshModelsDev(db, c.env.outbound));
    return c.json({ fetchedAt: null, models: {} } satisfies ModelsDevList);
  }
  const etag = `"${fetchedAt}"`;
  const headers = { etag, 'cache-control': 'private, no-cache' };
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
  const { results } = await db.prepare('SELECT model, price, input, output FROM models_dev WHERE list = ?').bind(list).all<Row>();
  const models = Object.fromEntries(results.map((row) => [row.model, { price: parsed<Rates>(row.price), input: parsed<ListedModality[]>(row.input), output: parsed<ListedModality[]>(row.output) }]));
  return c.json({ fetchedAt, models } satisfies ModelsDevList, 200, headers);
});
