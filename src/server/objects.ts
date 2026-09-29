import { Hono } from 'hono';
import { fail, ID, readObject, type AppEnv } from './http';
import { requireSession } from './session';

const KIND = /^[a-z][a-z-]{0,31}$/;
// D1 caps a row at 2 MB. Large things are split into objects before they get here.
const MAX_BODY_LENGTH = 1_500_000;
const PAGE_ROWS = 500;
const PAGE_BODY_LENGTH = 4_000_000;

type Row = { id: string; kind: string; parent_id: string | null; rev: number; deleted: number; fits: number; body: string | null };

export const objects = new Hono<AppEnv>();

objects.use(requireSession);

// A page stops at a row count or a body budget, whichever comes first, so a sync of many large
// objects never has to fit in the Worker's memory at once. The first row always fits. Rows past the
// budget come back without their bodies, only to tell whether more is waiting.
objects.get('/', async (c) => {
  const since = Number(c.req.query('since'));
  if (!Number.isSafeInteger(since) || since < 0) return fail(c, 400, 'bad-input');
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, parent_id, rev, deleted_at IS NOT NULL AS deleted, start < ?3 AS fits, CASE WHEN start < ?3 THEN body END AS body
     FROM (
       SELECT *, SUM(COALESCE(LENGTH(body), 0)) OVER (ORDER BY rev) - COALESCE(LENGTH(body), 0) AS start
       FROM objects WHERE account_id = ?1 AND rev > ?2
     ) ORDER BY rev LIMIT ?4`,
  )
    .bind(c.get('account').id, since, PAGE_BODY_LENGTH, PAGE_ROWS + 1)
    .all<Row>();
  const page: Row[] = [];
  for (const row of results) {
    if (page.length === PAGE_ROWS || !row.fits) break;
    page.push(row);
  }
  return c.json({
    changes: page.map((row) => ({ id: row.id, kind: row.kind, parent: row.parent_id, rev: row.rev, body: row.deleted ? null : row.body })),
    cursor: page.at(-1)?.rev ?? since,
    more: results.length > page.length,
  });
});

// Every write takes the account's next rev in the same batch, which D1 runs as one transaction. The
// rev is bumped only when the write will succeed, so a refused write leaves no gap. An update keeps
// the object's parent: one naming another parent is bad input, not a conflict, since pulling and
// trying again could never make it fit.
objects.put('/:id', async (c) => {
  const input = readWrite(c.req.param('id'), await readObject(c));
  if (!input) return fail(c, 400, 'bad-input');
  const { id, kind, parent, body, baseRev } = input;
  if (typeof body !== 'string' || !body) return fail(c, 400, 'bad-input');
  if (body.length > MAX_BODY_LENGTH) return fail(c, 413, 'too-large');
  const db = c.env.DB;
  const account = c.get('account').id;
  const [, written] = await db.batch<{ rev: number }>(
    baseRev === null
      ? [
          db
            .prepare('UPDATE accounts SET rev = rev + 1 WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM objects WHERE account_id = ?1 AND id = ?2)')
            .bind(account, id),
          db
            .prepare(
              'INSERT INTO objects (account_id, id, kind, parent_id, rev, body) SELECT ?1, ?2, ?3, ?4, rev, ?5 FROM accounts WHERE id = ?1 ON CONFLICT DO NOTHING RETURNING rev',
            )
            .bind(account, id, kind, parent, body),
        ]
      : [
          db
            .prepare(
              'UPDATE accounts SET rev = rev + 1 WHERE id = ?1 AND EXISTS (SELECT 1 FROM objects WHERE account_id = ?1 AND id = ?2 AND kind = ?3 AND rev = ?4 AND parent_id IS ?5)',
            )
            .bind(account, id, kind, baseRev, parent),
          db
            .prepare(
              'UPDATE objects SET body = ?6, deleted_at = NULL, rev = (SELECT rev FROM accounts WHERE id = ?1) WHERE account_id = ?1 AND id = ?2 AND kind = ?3 AND rev = ?4 AND parent_id IS ?5 RETURNING rev',
            )
            .bind(account, id, kind, baseRev, parent, body),
        ],
  );
  const rev = written!.results[0]?.rev;
  if (rev !== undefined) return c.json({ rev });
  if (baseRev !== null) {
    const stored = await db.prepare('SELECT parent_id FROM objects WHERE account_id = ?1 AND id = ?2').bind(account, id).first<{ parent_id: string | null }>();
    if (stored && stored.parent_id !== parent) return fail(c, 400, 'bad-input');
  }
  return fail(c, 409, 'conflict');
});

// A deleted object stays as a row without a body, so other devices learn of the deletion by sync.
// Writing it again with its current rev restores it (되돌리기).
objects.delete('/:id', async (c) => {
  const input = readWrite(c.req.param('id'), await readObject(c));
  if (!input || input.baseRev === null) return fail(c, 400, 'bad-input');
  const { id, kind, baseRev } = input;
  const db = c.env.DB;
  const account = c.get('account').id;
  const [, written] = await db.batch<{ rev: number }>([
    db
      .prepare(
        'UPDATE accounts SET rev = rev + 1 WHERE id = ?1 AND EXISTS (SELECT 1 FROM objects WHERE account_id = ?1 AND id = ?2 AND kind = ?3 AND rev = ?4 AND body IS NOT NULL)',
      )
      .bind(account, id, kind, baseRev),
    db
      .prepare(
        'UPDATE objects SET body = NULL, deleted_at = ?5, rev = (SELECT rev FROM accounts WHERE id = ?1) WHERE account_id = ?1 AND id = ?2 AND kind = ?3 AND rev = ?4 AND body IS NOT NULL RETURNING rev',
      )
      .bind(account, id, kind, baseRev, Date.now()),
  ]);
  const rev = written!.results[0]?.rev;
  if (rev === undefined) return fail(c, 409, 'conflict');
  return c.json({ rev });
});

function readWrite(id: string, body: Record<string, unknown> | null) {
  if (!ID.test(id) || !body) return null;
  const { kind, parent = null, baseRev = null } = body;
  if (typeof kind !== 'string' || !KIND.test(kind)) return null;
  if (parent !== null && (typeof parent !== 'string' || !ID.test(parent))) return null;
  if (baseRev !== null && (typeof baseRev !== 'number' || !Number.isSafeInteger(baseRev) || baseRev < 1)) return null;
  return { id, kind, parent, body: body.body, baseRev };
}
