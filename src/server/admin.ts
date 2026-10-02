import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { FILE_ID } from './files';
import { fail, ID, isAdmin, readObject, type AppEnv } from './http';
import { requireSession } from './session';

const MAX_REPORT_LENGTH = 4000;
// Reports are plaintext rows no byte cap counts, so one account's unresolved ones are bounded.
const MAX_OPEN_REPORTS = 20;
const PAGE_ROWS = 100;

// What any account, a suspended one too, sends the operator.
export const reports = new Hono<AppEnv>().use(requireSession).post('/', async (c) => {
  const body = await readObject(c);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_REPORT_LENGTH) return fail(c, 400, 'bad-input');
  const { id, username } = c.get('account');
  const sent = await c.env.DB.prepare(
    `INSERT INTO reports (account_id, username, text, created_at)
     SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM reports WHERE account_id = ?1 AND resolved_at IS NULL) < ?5 RETURNING id`,
  )
    .bind(id, username, text, Date.now(), MAX_OPEN_REPORTS)
    .first();
  return sent ? c.body(null, 204) : fail(c, 429, 'too-many-reports');
});

export const admin = new Hono<AppEnv>();

admin.use(requireSession);
admin.use(createMiddleware<AppEnv>(async (c, next) => (isAdmin(c, c.get('account').id) ? next() : fail(c, 403, 'not-admin'))));

// Every action below goes in one batch with its admin_log row, so the log never misses an action that happened and
// never holds one that did not. The row comes first and is written only if the target is there: a delete could not
// name its target afterwards.
// values: what detail names from ?4 on.
function logged(db: D1Database, action: string, table: 'accounts' | 'files', id: string, detail = 'NULL', ...values: unknown[]) {
  return db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?1, ?2, id, ${detail} FROM ${table} WHERE id = ?3`).bind(Date.now(), action, id, ...values);
}

const USERNAME = `json_object('username', username)`;

async function act(c: Context<AppEnv>, log: D1PreparedStatement, action: D1PreparedStatement) {
  const [, done] = await c.env.DB.batch([log, action]);
  return done!.results.length ? c.body(null, 204) : fail(c, 404, 'not-found');
}

// fileBytes: the files the account was first to store (files.ts). bytesCap, fileBytesCap: its own caps, 'default' while
// the service's apply.
admin.get('/accounts', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id AS accountId, username, created_at AS createdAt, suspended_at IS NOT NULL AS suspended, bytes, file_bytes AS fileBytes,
       own_bytes_cap, bytes_cap, own_file_bytes_cap, file_bytes_cap
     FROM accounts ORDER BY created_at, id`,
  ).all<{ suspended: number; own_bytes_cap: number; bytes_cap: number | null; own_file_bytes_cap: number; file_bytes_cap: number | null }>();
  return c.json({
    accounts: results.map(({ own_bytes_cap, bytes_cap, own_file_bytes_cap, file_bytes_cap, ...row }) => ({
      ...row,
      suspended: Boolean(row.suspended),
      bytesCap: own_bytes_cap ? bytes_cap : 'default',
      fileBytesCap: own_file_bytes_cap ? file_bytes_cap : 'default',
    })),
  });
});

admin.put('/accounts/:id/suspended', async (c) => {
  const id = c.req.param('id');
  const suspended = (await readObject(c))?.suspended;
  if (!ID.test(id) || typeof suspended !== 'boolean') return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  return act(
    c,
    logged(db, suspended ? 'suspend' : 'lift', 'accounts', id, USERNAME),
    db.prepare('UPDATE accounts SET suspended_at = ? WHERE id = ? RETURNING id').bind(suspended ? Date.now() : null, id),
  );
});

// Each cap: a count of bytes, null for none, or 'default' for the service's.
admin.put('/accounts/:id/caps', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const bytesCap = body?.bytesCap;
  const fileBytesCap = body?.fileBytesCap;
  if (!ID.test(id) || !ownCap(bytesCap) || !ownCap(fileBytesCap)) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  const own = (cap: unknown) => [cap === 'default' ? 0 : 1, cap === 'default' ? null : cap];
  return act(
    c,
    logged(db, 'set-caps', 'accounts', id, `json_object('username', username, 'bytesCap', json(?4), 'fileBytesCap', json(?5))`, JSON.stringify(bytesCap), JSON.stringify(fileBytesCap)),
    db.prepare('UPDATE accounts SET own_bytes_cap = ?2, bytes_cap = ?3, own_file_bytes_cap = ?4, file_bytes_cap = ?5 WHERE id = ?1 RETURNING id').bind(id, ...own(bytesCap), ...own(fileBytesCap)),
  );
});

// What stays is what stays after 탈퇴 (accounts.ts).
admin.delete('/accounts/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  return act(c, logged(db, 'delete-account', 'accounts', id, USERNAME), db.prepare('DELETE FROM accounts WHERE id = ? RETURNING id').bind(id));
});

// bytes: every account's object bodies, the part of the database that grows. fileBytes: every stored file, a deleted
// account's too.
admin.get('/service', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT signup_cap AS signupCap, account_bytes_cap AS accountBytesCap, account_file_bytes_cap AS accountFileBytesCap,
       (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COALESCE(SUM(bytes), 0) FROM accounts) AS bytes,
       (SELECT COALESCE(SUM(size), 0) FROM files) AS fileBytes
     FROM service`,
  ).first();
  return c.json(row);
});

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const cap = (value: unknown) => value === null || count(value);
const ownCap = (value: unknown) => value === 'default' || cap(value);

admin.put('/service', async (c) => {
  const body = await readObject(c);
  const signupCap = body?.signupCap;
  const accountBytesCap = body?.accountBytesCap;
  const accountFileBytesCap = body?.accountFileBytesCap;
  if (!count(signupCap) || !cap(accountBytesCap) || !cap(accountFileBytesCap)) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  await db.batch([
    db.prepare(`INSERT INTO admin_log (at, action, target, detail) VALUES (?, 'set-service', 'service', ?)`).bind(Date.now(), JSON.stringify({ signupCap, accountBytesCap, accountFileBytesCap })),
    db.prepare('UPDATE service SET signup_cap = ?, account_bytes_cap = ?, account_file_bytes_cap = ?').bind(signupCap, accountBytesCap, accountFileBytesCap),
  ]);
  return c.body(null, 204);
});

// Newest first. before: the last id of the page before, for the next one. A page shorter than PAGE_ROWS is the last.
function page(c: Context<AppEnv>, select: string) {
  const before = c.req.query('before');
  if (before !== undefined && !/^[1-9]\d{0,15}$/.test(before)) return null;
  return c.env.DB.prepare(`${select} WHERE ?1 IS NULL OR id < ?1 ORDER BY id DESC LIMIT ?2`).bind(before === undefined ? null : Number(before), PAGE_ROWS);
}

admin.get('/reports', async (c) => {
  const rows = page(c, 'SELECT id, account_id AS accountId, username, text, created_at AS createdAt, resolved_at AS resolvedAt FROM reports');
  return rows ? c.json({ reports: (await rows.all()).results }) : fail(c, 400, 'bad-input');
});

admin.post('/reports/:id/resolve', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id)) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?, 'resolve-report', id FROM reports WHERE id = ? AND resolved_at IS NULL`).bind(Date.now(), id),
    db.prepare('UPDATE reports SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL RETURNING id').bind(Date.now(), id),
  );
});

// A block refuses the file to every account (files.ts). The body stays in R2, so lifting the block brings it back.
admin.put('/files/:id/blocked', async (c) => {
  const id = c.req.param('id');
  const blocked = (await readObject(c))?.blocked;
  if (!FILE_ID.test(id) || typeof blocked !== 'boolean') return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  return act(c, logged(db, blocked ? 'block-file' : 'unblock-file', 'files', id), db.prepare('UPDATE files SET blocked_at = ? WHERE id = ? RETURNING id').bind(blocked ? Date.now() : null, id));
});

admin.get('/log', async (c) => {
  const rows = page(c, 'SELECT id, at, action, target, detail FROM admin_log');
  if (!rows) return fail(c, 400, 'bad-input');
  const { results } = await rows.all<{ detail: string | null }>();
  return c.json({ log: results.map((row) => ({ ...row, detail: row.detail === null ? null : (JSON.parse(row.detail) as unknown) })) });
});
