import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Phase } from './account-store';
import { FILE_BYTES, fileBlocks } from './files';
import { fail, ID, isAdmin, readObject, refused, type AppEnv, type State } from './http';
import { beginRestore, cancelRestore, leaveAccount, restoreActions, runRestore, store, undoable, UNDO_LIFE_MS } from './lifecycle';
import { requireSession } from './session';

const MAX_REPORT_LENGTH = 4000;
// Reports are plaintext rows no byte cap counts, so one account's unresolved ones are bounded.
const MAX_OPEN_REPORTS = 20;
const MAX_NOTICE_LENGTH = 2000;
const PAGE_ROWS = 100;
// How long a resolved report and a log row are kept, as the privacy page says. An open report stays whatever its age.
const KEEP_MS = 365 * 24 * 60 * 60 * 1000;

export async function forgetOldRecords(db: D1Database): Promise<void> {
  const before = Date.now() - KEEP_MS;
  await db.batch([db.prepare('DELETE FROM reports WHERE resolved_at < ?').bind(before), db.prepare('DELETE FROM admin_log WHERE at < ?').bind(before)]);
}

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

// The notices an account reads, over a notices row and an accounts row (both unaliased): its own, and those to every
// account sent at or after it was created. The list and the session's unread count read the same text.
export const VISIBLE = '(notices.incarnation = accounts.incarnation OR (notices.incarnation IS NULL AND notices.created_at >= accounts.created_at))';

// What any account, a suspended one too, reads of what the operator sent. Newest first, paged like the operator's lists.
export const notices = new Hono<AppEnv>()
  .use(requireSession)
  .get('/', async (c) => {
    const rows = page(
      c,
      'SELECT id, report_id AS reportId, text, created_at AS createdAt FROM notices',
      `EXISTS (SELECT 1 FROM accounts WHERE accounts.incarnation = ?3 AND ${VISIBLE})`,
      c.get('account').incarnation,
    );
    return rows ? c.json({ notices: (await rows.all()).results }) : fail(c, 400, 'bad-input');
  })
  // id: the newest notice the page showed, so one sent since it was read stays unread.
  .post('/seen', async (c) => {
    const id = (await readObject(c))?.id;
    if (!positive(id)) return fail(c, 400, 'bad-input');
    await c.env.DB.prepare('UPDATE accounts SET notices_seen = MAX(notices_seen, ?) WHERE incarnation = ?').bind(id, c.get('account').incarnation).run();
    return c.body(null, 204);
  });

export const admin = new Hono<AppEnv>();

admin.use(requireSession);
admin.use(createMiddleware<AppEnv>(async (c, next) => (isAdmin(c, c.get('account').id) ? next() : fail(c, 403, 'not-admin'))));

// Every action below goes in one batch with its admin_log row, so the log never misses an action that happened and
// never holds one that did not. The row comes first and is written only if the target is there: a delete could not
// name its target afterwards.
// values: what detail names from ?4 on.
function logged(db: D1Database, action: string, id: string, detail = 'NULL', ...values: unknown[]) {
  return db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?1, ?2, id, ${detail} FROM accounts WHERE id = ?3`).bind(Date.now(), action, id, ...values);
}

const USERNAME = `json_object('username', username)`;

// The last statement is the action, and answers the row it wrote.
async function act(c: Context<AppEnv>, ...statements: D1PreparedStatement[]) {
  const done = await c.env.DB.batch(statements);
  return done.at(-1)!.results.length ? c.body(null, 204) : fail(c, 404, 'not-found');
}

const noticeText = (value: unknown) => (typeof value === 'string' && value.trim() && value.trim().length <= MAX_NOTICE_LENGTH ? value.trim() : null);
// The text of a notice sent with an act: null for none, blank among them; undefined for one too long to send.
const optionalText = (value: unknown) => (value === undefined || (typeof value === 'string' && !value.trim()) ? null : (noticeText(value) ?? undefined));

// Whom a notice is to: a FROM clause naming one accounts row by ?1, or null for every account.
type Target = { from: string; key: string | number };
const toAccount = (id: string): Target => ({ from: 'accounts WHERE accounts.id = ?1', key: id });
// A report's sender, while the report is open and its account is the one that sent it, not a later one holding its id.
const toSender = (report: number): Target => ({
  from: 'reports JOIN accounts ON accounts.id = reports.account_id AND accounts.created_at <= reports.created_at WHERE reports.id = ?1 AND reports.resolved_at IS NULL',
  key: report,
});

// The only writer of notices: its log row, then the notice, each written only if its account is there.
function noticed(db: D1Database, text: string, to: Target | null, report: number | null = null): D1PreparedStatement[] {
  const now = Date.now();
  if (!to) {
    return [
      db.prepare(`INSERT INTO admin_log (at, action, target) VALUES (?, 'send-notice', 'everyone')`).bind(now),
      db.prepare('INSERT INTO notices (text, created_at) VALUES (?, ?) RETURNING id').bind(text, now),
    ];
  }
  return [
    db
      .prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?2, 'send-notice', accounts.id, json_object('username', accounts.username, 'report', ?3) FROM ${to.from}`)
      .bind(to.key, now, report),
    db.prepare(`INSERT INTO notices (incarnation, report_id, text, created_at) SELECT accounts.incarnation, ?3, ?4, ?2 FROM ${to.from} RETURNING id`).bind(to.key, now, report, text),
  ];
}

// At most this many store calls are in flight, and the page is answered by the deadline with what was read by then.
const USAGE_SLOTS = 50;
const USAGE_DEADLINE_MS = 10_000;

// bytes, disk: what the account's store answered, null for an account not read by the deadline, failing, or not
// active (restoring and leaving accounts are not called). fileBytes: the sum of its pictures. bytesCap, fileBytesCap:
// its own caps, 'default' while the service's apply. totals: a reading of the accounts that answered, at readAt.
admin.get('/accounts', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id AS accountId, username, created_at AS createdAt, suspended_at IS NOT NULL AS suspended, state, incarnation, ${FILE_BYTES} AS fileBytes,
       own_bytes_cap, bytes_cap, own_file_bytes_cap, file_bytes_cap
     FROM accounts ORDER BY created_at, id`,
  ).all<{
    accountId: string;
    username: string;
    createdAt: number;
    suspended: number;
    state: State;
    incarnation: string;
    fileBytes: number;
    own_bytes_cap: number;
    bytes_cap: number | null;
    own_file_bytes_cap: number;
    file_bytes_cap: number | null;
  }>();
  const usages = await readAll(
    results.map(({ state, incarnation }) => (state === 'active' ? () => store(c.env, incarnation).usage(incarnation) : null)),
    USAGE_SLOTS,
    USAGE_DEADLINE_MS,
  );
  const accounts = results.map((row, index) => {
    const usage = usages[index];
    const read = usage && 'bytes' in usage ? usage : null;
    return {
      accountId: row.accountId,
      username: row.username,
      createdAt: row.createdAt,
      suspended: Boolean(row.suspended),
      state: row.state,
      bytes: read?.bytes ?? null,
      disk: read?.disk ?? null,
      fileBytes: row.fileBytes,
      bytesCap: row.own_bytes_cap ? row.bytes_cap : 'default',
      fileBytesCap: row.own_file_bytes_cap ? row.file_bytes_cap : 'default',
    };
  });
  const answered = accounts.filter(({ bytes }) => bytes !== null);
  return c.json({
    accounts,
    totals: {
      bytes: answered.reduce((sum, { bytes }) => sum + bytes!, 0),
      disk: answered.reduce((sum, { disk }) => sum + disk!, 0),
      unread: accounts.length - answered.length,
      readAt: Date.now(),
    },
  });
});

// Runs each call that is not null with at most slots of them in flight, a slot held until its call settles, since a
// call cannot be aborted. At the deadline no call starts any more, and what has not settled is answered as undefined:
// a call that settles later changes nothing.
export async function readAll<T>(calls: ((() => Promise<T>) | null)[], slots: number, deadlineMs: number): Promise<(T | undefined)[]> {
  const settled: (T | undefined)[] = calls.map(() => undefined);
  let next = 0;
  let open = true;
  const slot = async () => {
    while (open && next < calls.length) {
      const index = next++;
      const call = calls[index];
      if (!call) continue;
      const answer = await call().catch(() => undefined);
      if (open) settled[index] = answer;
    }
  };
  let reached = () => {};
  const deadline = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const timer = setTimeout(reached, deadlineMs);
  await Promise.race([Promise.all(Array.from({ length: slots }, slot)), deadline]);
  open = false;
  clearTimeout(timer);
  return settled;
}

// to: an account id, or null for every account.
admin.post('/notices', async (c) => {
  const body = await readObject(c);
  const to = body?.to;
  const text = noticeText(body?.text);
  if (!text || !(to === null || (typeof to === 'string' && ID.test(to)))) return fail(c, 400, 'bad-input');
  return act(c, ...noticed(c.env.DB, text, to === null ? null : toAccount(to)));
});

// reason: a notice to the account, sent with the change. A suspension cannot go without one: the terms promise every
// suspended account is told why.
admin.put('/accounts/:id/suspended', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const suspended = body?.suspended;
  const reason = optionalText(body?.reason);
  if (!ID.test(id) || typeof suspended !== 'boolean' || reason === undefined || (suspended && reason === null)) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  return act(
    c,
    logged(db, suspended ? 'suspend' : 'lift', id, USERNAME),
    ...(reason === null ? [] : noticed(db, reason, toAccount(id))),
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
    logged(db, 'set-caps', id, `json_object('username', username, 'bytesCap', json(?4), 'fileBytesCap', json(?5))`, JSON.stringify(bytesCap), JSON.stringify(fileBytesCap)),
    db.prepare('UPDATE accounts SET own_bytes_cap = ?2, bytes_cap = ?3, own_file_bytes_cap = ?4, file_bytes_cap = ?5 WHERE id = ?1 RETURNING id').bind(id, ...own(bytesCap), ...own(fileBytesCap)),
  );
});

// What stays is what stays after 탈퇴 (accounts.ts). Repeatable: it finishes a leaving account (마무리).
admin.delete('/accounts/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return fail(c, 400, 'bad-input');
  const incarnation = await c.env.DB.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(id).first<string>('incarnation');
  if (incarnation === null) return fail(c, 404, 'not-found');
  const left = await leaveAccount(c.env, id, incarnation, true);
  if (left === 'busy') return fail(c, 409, 'account-busy');
  if (left === 'unavailable') return refused(c, { unavailable: true });
  return c.body(null, 204);
});

// A restore of the account's store, on a report it sent: { report, at } for its state at a time, or { report, undoes }
// to undo its latest finished restore. The operation runs in this request (lifecycle.ts).
admin.post('/accounts/:id/restores', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const report = body?.report;
  const at = body?.at;
  const undoes = body?.undoes;
  const from = at === undefined ? (positive(undoes) ? { undoes } : null) : undoes === undefined && count(at) ? { at } : null;
  if (!ID.test(id) || !positive(report) || !from) return fail(c, 400, 'bad-input');
  const begun = await beginRestore(c.env, id, report, from);
  if ('refused' in begun) return fail(c, REFUSAL_STATUS[begun.refused], begun.refused);
  return c.json(await runRestore(c.env, begun.begun));
});

const REFUSAL_STATUS = { 'not-found': 404, 'account-busy': 409, 'bad-report': 400, 'bad-time': 400, 'cannot-undo': 400 } as const;

// Newest first. canUndo, undoExpiresAt: whether and until when an undo of this restore can begin. actions: what its
// phase allows.
admin.get('/accounts/:id/restores', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.report_id AS reportId, r.at, r.undoes, r.phase, r.verified, r.error, r.created_at AS createdAt, r.updated_at AS updatedAt,
       r.checkpoint_at, ${undoable('r.id', '?2')} AS canUndo
     FROM restores r JOIN accounts ON accounts.incarnation = r.incarnation WHERE accounts.id = ?1 ORDER BY r.id DESC`,
  )
    .bind(c.req.param('id'), Date.now())
    .all<{ phase: Phase; verified: number; canUndo: number; checkpoint_at: number | null }>();
  return c.json({
    restores: results.map(({ checkpoint_at, canUndo, ...row }) => ({
      ...row,
      verified: Boolean(row.verified),
      canUndo: Boolean(canUndo),
      undoExpiresAt: canUndo ? checkpoint_at! + UNDO_LIFE_MS : null,
      actions: restoreActions(row.phase, Boolean(row.verified)),
    })),
  });
});

// Resume and finalize both run the operation on from its phase: they are retries of it.
admin.post('/restores/:id/:action{resume|finalize}', async (c) => {
  const id = Number(c.req.param('id'));
  if (!positive(id)) return fail(c, 400, 'bad-input');
  const ran = await runRestore(c.env, id);
  return ran ? c.json(ran) : fail(c, 404, 'not-found');
});

admin.post('/restores/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'));
  if (!positive(id)) return fail(c, 400, 'bad-input');
  const ran = await cancelRestore(c.env, id);
  if (ran === 'too-late') return fail(c, 409, 'cannot-cancel');
  return ran ? c.json(ran) : fail(c, 404, 'not-found');
});

// fileBytes: the pictures every account holds.
admin.get('/service', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT signup_cap AS signupCap, account_bytes_cap AS accountBytesCap, account_file_bytes_cap AS accountFileBytesCap,
       (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COALESCE(SUM(size), 0) FROM account_files) AS fileBytes
     FROM service`,
  ).first();
  return c.json(row);
});

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive = (value: unknown): value is number => count(value) && value > 0;
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
// where: what else a row must meet, with its values from ?3 on.
function page(c: Context<AppEnv>, select: string, where = 'TRUE', ...values: unknown[]) {
  const before = c.req.query('before');
  if (before !== undefined && !/^[1-9]\d{0,15}$/.test(before)) return null;
  return c.env.DB.prepare(`${select} WHERE (?1 IS NULL OR id < ?1) AND ${where} ORDER BY id DESC LIMIT ?2`).bind(before === undefined ? null : Number(before), PAGE_ROWS, ...values);
}

admin.get('/reports', async (c) => {
  const rows = page(c, 'SELECT id, account_id AS accountId, username, text, created_at AS createdAt, resolved_at AS resolvedAt FROM reports');
  return rows ? c.json({ reports: (await rows.all()).results }) : fail(c, 400, 'bad-input');
});

// reply: a notice to the report's sender, which must still hold its account: a reply that cannot arrive resolves nothing.
admin.post('/reports/:id/resolve', async (c) => {
  const id = Number(c.req.param('id'));
  const reply = optionalText((await readObject(c))?.reply);
  if (!Number.isSafeInteger(id) || reply === undefined) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  const open = reply === null ? 'reports WHERE reports.id = ?1 AND reports.resolved_at IS NULL' : toSender(id).from;
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, 'resolve-report', reports.id FROM ${open}`).bind(id, Date.now()),
    ...(reply === null ? [] : noticed(db, reply, toSender(id), id)),
    db.prepare(`UPDATE reports SET resolved_at = ?2 WHERE id IN (SELECT reports.id FROM ${open}) RETURNING id`).bind(id, Date.now()),
  );
});

admin.route('/', fileBlocks);

admin.get('/log', async (c) => {
  const rows = page(c, 'SELECT id, at, action, target, detail FROM admin_log');
  if (!rows) return fail(c, 400, 'bad-input');
  const { results } = await rows.all<{ detail: string | null }>();
  return c.json({ log: results.map((row) => ({ ...row, detail: row.detail === null ? null : (JSON.parse(row.detail) as unknown) })) });
});
