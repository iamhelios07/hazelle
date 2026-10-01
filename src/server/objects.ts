import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { FILE_ID } from './files';
import { fail, ID, readObject, type AppEnv } from './http';
import { requireSession } from './session';

const KIND = /^[a-z][a-z-]{0,31}$/;
// https://developers.cloudflare.com/d1/platform/limits/: 1,000 queries per invocation on Workers Paid, which this
// account runs on, 100 binds/query, 2 MB/row. A batch uses items + 2 statements (at most 8 binds each), plus session queries.
// The 4 MB HTTP budget stays below Workers' 100 MB request and 128 MB memory limits.
export const BATCH_LIMITS = { items: 200, bytes: 4_000_000, body: 1_500_000 };
const PAGE_ROWS = 500;
const PAGE_BODY_LENGTH = 4_000_000;

type Row = { id: string; kind: string; parent_id: string | null; rev: number; deleted: number; fits: number; omitted: number; body: string | null };

export const objects = new Hono<AppEnv>();

objects.use(requireSession);

// A page stops at a row count or a body budget, whichever comes first, so a sync of many large
// objects never has to fit in the Worker's memory at once. The first row always fits. Rows past the
// budget come back without their bodies, only to tell whether more is waiting.
// Bound candidates before the window sum; an outer LIMIT still sums the rest of the account.
objects.get('/', async (c) => {
  const since = Number(c.req.query('since'));
  if (!Number.isSafeInteger(since) || since < 0) return fail(c, 400, 'bad-input');
  const excluded = c.req.query('exclude')?.split(',') ?? [];
  const parent = c.req.query('parent');
  const bootstrap = c.req.query('bootstrap') === '1';
  const metadata = c.req.query('metadata') === '1';
  if (excluded.length > 32 || excluded.some((kind) => !KIND.test(kind)) || (parent !== undefined && !ID.test(parent))) return fail(c, 400, 'bad-input');
  const account = c.get('account').id;
  const until = bootstrap ? Number(c.req.query('until') ?? await c.env.DB.prepare('SELECT rev FROM accounts WHERE id = ?').bind(account).first('rev')) : null;
  if (until !== null && (!Number.isSafeInteger(until) || until < since)) return fail(c, 400, 'bad-input');
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, parent_id, rev, deleted_at IS NOT NULL AS deleted, omitted, start < ?3 AS fits, CASE WHEN start < ?3 THEN body END AS body
     FROM (
       SELECT *, SUM(COALESCE(LENGTH(body), 0)) OVER (ORDER BY rev) - COALESCE(LENGTH(body), 0) AS start
       FROM (
         SELECT id, kind, parent_id, rev, deleted_at,
           (kind IN (SELECT value FROM json_each(?5)) OR ${metadata ? 1 : 0}) AND deleted_at IS NULL AS omitted,
           CASE WHEN kind NOT IN (SELECT value FROM json_each(?5)) AND ${metadata ? 0 : 1} THEN body END AS body
         FROM objects WHERE account_id = ?1 AND rev > ?2
           ${parent === undefined ? '' : 'AND parent_id = ?6'}
           ${bootstrap ? 'AND kind NOT IN (SELECT value FROM json_each(?5)) AND rev <= ?7' : ''}
         ORDER BY rev LIMIT ?4
       )
     ) ORDER BY rev`,
  )
    .bind(...[account, since, PAGE_BODY_LENGTH, PAGE_ROWS + 1, JSON.stringify(excluded), ...(parent !== undefined || bootstrap ? [parent ?? null] : []), ...(bootstrap ? [until] : [])])
    .all<Row>();
  const page: Row[] = [];
  for (const row of results) {
    if (page.length === PAGE_ROWS || !row.fits) break;
    page.push(row);
  }
  return c.json({
    limits: BATCH_LIMITS,
    ...(until === null ? {} : { until }),
    changes: page.map((row) => ({ id: row.id, kind: row.kind, parent: row.parent_id, rev: row.rev, ...(row.omitted ? { omitted: true } : { body: row.deleted ? null : row.body }) })),
    cursor: page.at(-1)?.rev ?? since,
    more: results.length > page.length,
  });
});

// file: the stored file the object names (server/files), which the server sees; a deletion names none.
type Write = { id: string; kind: string; parent: string | null; body: string | null; baseRev: number | null; file: string | null };

// Every write in a batch takes the account's next rev, in the order given, in one D1 transaction. An update keeps
// the object's parent: one naming another parent is bad input, not a conflict, since pulling and trying again could
// never make it fit. A deleted object stays as a row without a body, so other devices learn of the deletion by sync;
// writing it again with its current rev restores it (되돌리기).
objects.post('/batch', bodyLimit({ maxSize: BATCH_LIMITS.bytes, onError: (c) => fail(c, 413, 'too-large') }), async (c) => {
  const input = await readObject(c);
  if (!input || !Array.isArray(input.writes) || !input.writes.length) return fail(c, 400, 'bad-input');
  if (input.writes.length > BATCH_LIMITS.items) return fail(c, 413, 'too-large');
  const writes: Write[] = [];
  const ids = new Set<string>();
  for (const item of input.writes) {
    const write = readWrite(item);
    if (!write || ids.has(write.id)) return fail(c, 400, 'bad-input');
    if (write.body !== null && new TextEncoder().encode(write.body).length > BATCH_LIMITS.body) return fail(c, 413, 'too-large');
    ids.add(write.id);
    writes.push(write);
  }
  const db = c.env.DB;
  const account = c.get('account').id;
  const checks = JSON.stringify(writes.map(({ id, kind, parent, baseRev, body }) => ({ id, kind, parent, baseRev, remove: body === null })));
  const candidates = `FROM json_each(?2) AS w LEFT JOIN objects AS o ON o.account_id = ?1 AND o.id = json_extract(w.value, '$.id')`;
  const moved = `o.id IS NOT NULL AND o.parent_id IS NOT json_extract(w.value, '$.parent')`;
  // changes() gates the entire chain on the first statement. No read outside this transaction
  // decides whether to write; a later item's conflict must leave even accounts.rev untouched.
  const results = await db.batch<{ rev: number; moved: number }>([
    db.prepare(`UPDATE accounts SET rev = rev + ?3 WHERE id = ?1 AND NOT EXISTS (
      SELECT 1 ${candidates} WHERE
        CASE WHEN json_extract(w.value, '$.baseRev') IS NULL THEN o.id IS NOT NULL
        ELSE o.id IS NULL OR o.kind != json_extract(w.value, '$.kind')
          OR o.rev != json_extract(w.value, '$.baseRev') OR ${moved}
          OR (json_extract(w.value, '$.remove') AND o.body IS NULL) END
      ) RETURNING rev`).bind(account, checks, writes.length),
    ...writes.map(({ id, kind, parent, body, file }, index) =>
      db.prepare(`INSERT INTO objects (account_id, id, kind, parent_id, rev, body, deleted_at, file_id)
        SELECT ?1, ?2, ?3, ?4, rev - ?5, ?6, ?7, ?8 FROM accounts WHERE id = ?1 AND changes() = 1
        ON CONFLICT (account_id, id) DO UPDATE SET rev = excluded.rev, body = excluded.body, deleted_at = excluded.deleted_at, file_id = excluded.file_id
        RETURNING rev`).bind(account, id, kind, parent, writes.length - index - 1, body, body === null ? Date.now() : null, body === null ? null : file),
    ),
    db.prepare(`SELECT EXISTS (SELECT 1 ${candidates} WHERE json_extract(w.value, '$.baseRev') IS NOT NULL AND ${moved}) AS moved`).bind(account, checks),
  ]);
  if (!results[0]!.results.length) {
    return results.at(-1)!.results[0]!.moved ? fail(c, 400, 'bad-input') : fail(c, 409, 'conflict');
  }
  return c.json({ revs: results.slice(1, -1).map(({ results }) => results[0]!.rev) });
});

function readWrite(input: unknown): Write | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const { id, kind, parent, body, baseRev, file = null } = input as Record<string, unknown>;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof kind !== 'string' || !KIND.test(kind)) return null;
  if (parent !== null && (typeof parent !== 'string' || !ID.test(parent))) return null;
  if (baseRev !== null && (typeof baseRev !== 'number' || !Number.isSafeInteger(baseRev) || baseRev < 1)) return null;
  if (body !== null && (typeof body !== 'string' || !body)) return null;
  if (body === null && baseRev === null) return null;
  if (file !== null && (typeof file !== 'string' || !FILE_ID.test(file))) return null;
  return { id, kind, parent, body, baseRev, file };
}
