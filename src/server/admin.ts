import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { type AccountState, type RestoreAction, MAX_DIAGNOSTICS_LENGTH, MAX_REPORT_LENGTH, MAX_NOTICE_LENGTH } from '../contracts/admin';
import { SHARE_ID } from '../contracts/shares';
import { blockFiles, fileBlocks } from './files';
import { serveShareFile } from './shares';
import type { Db, SqlValue, Statement } from './db/service-db';
import { fail, ID, readObject, type AppEnv, type Services } from './http';
import { answerAction, answerBegin, leaveAccount, refuseLeft, restoreFrom, restorePoints, restoresOf, store } from './lifecycle';
import { requireSession } from './session';

// Reports are plaintext rows no byte cap counts, so one account's unresolved ones are bounded.
const MAX_OPEN_REPORTS = 20;
const PAGE_ROWS = 100;
// How long a resolved report and a log row are kept, as the privacy page says. An open report stays whatever its age.
const KEEP_MS = 365 * 24 * 60 * 60 * 1000;

export async function forgetOldRecords(db: Db): Promise<void> {
  const before = Date.now() - KEEP_MS;
  await db.batch([db.prepare('DELETE FROM reports WHERE resolved_at < ?').bind(before), db.prepare('DELETE FROM admin_log WHERE at < ?').bind(before)]);
}

// What any account, a suspended one too, sends the operator.
export const reports = new Hono<AppEnv>().use(requireSession).post('/', async (c) => {
  const body = await readObject(c);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const diagnostics = body?.diagnostics ?? null;
  if (!text || text.length > MAX_REPORT_LENGTH) return fail(c, 400, 'bad-input');
  if (diagnostics !== null && (typeof diagnostics !== 'string' || diagnostics.length > MAX_DIAGNOSTICS_LENGTH)) return fail(c, 400, 'bad-input');
  const { id, username, incarnation } = c.get('account');
  // Reports must not predate their account: restore and reply eligibility use that bound even if wall time regresses.
  const sent = await c.env.db.prepare(
    `INSERT INTO reports (account_id, username, text, created_at, diagnostics)
     SELECT ?1, ?2, ?3, MAX(?4, created_at), ?7 FROM accounts WHERE id = ?1 AND incarnation = ?6
     AND (SELECT COUNT(*) FROM reports WHERE account_id = ?1 AND share IS NULL AND resolved_at IS NULL) < ?5 RETURNING id`,
  )
    .bind(id, username, text, Date.now(), MAX_OPEN_REPORTS, incarnation, diagnostics)
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
    await c.env.db.prepare('UPDATE accounts SET notices_seen = MAX(notices_seen, ?) WHERE incarnation = ?').bind(id, c.get('account').incarnation).run();
    return c.body(null, 204);
  });

export const admin = new Hono<AppEnv>();

admin.use(requireSession);
admin.use(createMiddleware<AppEnv>(async (c, next) => (c.get('account').admin ? next() : fail(c, 403, 'not-admin'))));

// Every action below goes in one batch with its admin_log row, so the log never misses an action that happened and
// never holds one that did not. The row comes first and is written only if the target is there: a delete could not
// name its target afterwards.
// values: what detail names from ?4 on.
function logged(db: Db, action: string, id: string, detail = 'NULL', ...values: SqlValue[]) {
  return db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?1, ?2, id, ${detail} FROM accounts WHERE id = ?3`).bind(Date.now(), action, id, ...values);
}

const USERNAME = `json_object('username', username)`;

// The last statement is the action, and answers the row it wrote.
async function act(c: Context<AppEnv>, ...statements: Statement[]) {
  const done = await c.env.db.batch(statements);
  return done.at(-1)!.results.length ? c.body(null, 204) : fail(c, 404, 'not-found');
}

const noticeText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= MAX_NOTICE_LENGTH ? text : null;
};
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
function noticed(db: Db, text: string, to: Target | null, report: number | null = null): Statement[] {
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

type AccountRow = {
  accountId: string;
  username: string;
  createdAt: number;
  suspended: number;
  state: AccountState;
  incarnation: string;
  fileBytes: number;
  own_bytes_cap: number;
  bytes_cap: number | null;
  own_file_bytes_cap: number;
  file_bytes_cap: number | null;
};
const ACCOUNT_COLUMNS = `id AS accountId, username, created_at AS createdAt, suspended_at IS NOT NULL AS suspended,
  state, incarnation, file_bytes AS fileBytes, own_bytes_cap, bytes_cap, own_file_bytes_cap, file_bytes_cap`;
type Usage = { bytes: number; disk: number } | null;

// Keyset pages stay bounded after deletions and do not scan an ever-growing OFFSET. The (created_at, id) index owns
// this order; the cursor includes both because accounts can share their creation millisecond.
function accountPage(c: Context<AppEnv>, columns: string) {
  const after = c.req.query('after');
  if (after === undefined) return c.env.db.prepare(`SELECT ${columns} FROM accounts ORDER BY created_at, id LIMIT ?`).bind(PAGE_ROWS);
  const split = after.indexOf(':');
  const at = Number(after.slice(0, split));
  const id = after.slice(split + 1);
  if (split < 1 || !count(at) || !ID.test(id)) return null;
  return c.env.db.prepare(`SELECT ${columns} FROM accounts WHERE (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT ?`).bind(at, id, PAGE_ROWS);
}

const afterAccounts = (rows: Pick<AccountRow, 'accountId' | 'createdAt'>[]) =>
  rows.length === PAGE_ROWS ? `${rows.at(-1)!.createdAt}:${rows.at(-1)!.accountId}` : null;

// bytes, disk: what the account's store answered, null for an account not read by the deadline, failing, or not
// active (restoring and leaving accounts are not called). fileBytes: the sum of its pictures. bytesCap, fileBytesCap:
// its own caps, 'default' while the service's apply. Whole-service totals are read separately through /usage.
admin.get('/accounts', async (c) => {
  const page = accountPage(c, ACCOUNT_COLUMNS);
  if (!page) return fail(c, 400, 'bad-input');
  const { results } = await page.all<AccountRow>();
  const usages = await accountUsage(c.env, results);
  return c.json({ accounts: results.map((row, index) => shownAccount(row, usages[index]!)), next: afterAccounts(results) });
});

// Each request calls only this page's stores and answers sums. Ordinary actions never start this scan.
admin.get('/usage', async (c) => {
  const page = accountPage(c, 'id AS accountId, created_at AS createdAt, state, incarnation');
  if (!page) return fail(c, 400, 'bad-input');
  const { results } = await page.all<Pick<AccountRow, 'accountId' | 'createdAt' | 'state' | 'incarnation'>>();
  const totals = { bytes: 0, disk: 0, unread: 0 };
  for (const usage of await accountUsage(c.env, results)) {
    if (usage === null) totals.unread++;
    else {
      totals.bytes += usage.bytes;
      totals.disk += usage.disk;
    }
  }
  return c.json({ totals: { ...totals, readAt: Date.now() }, accounts: results.length, next: afterAccounts(results) });
});

// A change refreshes only its row. A deleted account is absent rather than a reason to reload the service.
admin.get('/accounts/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return fail(c, 400, 'bad-input');
  const row = await c.env.db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`).bind(id).first<AccountRow>();
  const usage = row ? (await accountUsage(c.env, [row]))[0]! : null;
  return c.json({ account: row ? shownAccount(row, usage) : null });
});

async function accountUsage(env: Services, rows: Pick<AccountRow, 'state' | 'incarnation'>[]): Promise<Usage[]> {
  const answers = await readAll(
    rows.map(({ state, incarnation }) => (state === 'active' ? () => store(env, incarnation).usage(incarnation) : null)),
    USAGE_SLOTS,
    USAGE_DEADLINE_MS,
  );
  return answers.map((usage) => usage && 'bytes' in usage ? usage : null);
}

function shownAccount(row: AccountRow, usage: Usage) {
  return {
    accountId: row.accountId,
    username: row.username,
    createdAt: row.createdAt,
    suspended: Boolean(row.suspended),
    state: row.state,
    bytes: usage?.bytes ?? null,
    disk: usage?.disk ?? null,
    fileBytes: row.fileBytes,
    bytesCap: row.own_bytes_cap ? row.bytes_cap : 'default',
    fileBytesCap: row.own_file_bytes_cap ? row.file_bytes_cap : 'default',
  };
}

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
  return act(c, ...noticed(c.env.db, text, to === null ? null : toAccount(to)));
});

// reason: a notice to the account, sent with the change. A suspension cannot go without one: the terms promise every
// suspended account is told why.
admin.put('/accounts/:id/suspended', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const suspended = body?.suspended;
  const reason = optionalText(body?.reason);
  if (!ID.test(id) || typeof suspended !== 'boolean' || reason === undefined || (suspended && reason === null)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
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
  const db = c.env.db;
  const own = (cap: number | null | 'default') => [cap === 'default' ? 0 : 1, cap === 'default' ? null : cap];
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
  const incarnation = await incarnationOf(c, id);
  if (incarnation === null) return fail(c, 404, 'not-found');
  const left = await leaveAccount(c.env, c.executionCtx, id, incarnation, true);
  if (left !== 'left') return refuseLeft(c, left);
  return c.body(null, 204);
});

admin.post('/accounts/:id/restores', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const report = body?.report;
  const from = restoreFrom(body);
  if (!ID.test(id) || !positive(report) || !from) return fail(c, 400, 'bad-input');
  return answerBegin(c, id, report, from);
});

const incarnationOf = (c: Context<AppEnv>, id: string) => c.env.db.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(id).first<string>('incarnation');

admin.get('/accounts/:id/points', async (c) => {
  const points = await restorePoints(c.env.db, c.req.param('id'));
  return points ? c.json({ points }) : fail(c, 404, 'not-found');
});

admin.get('/accounts/:id/restores', async (c) => c.json({ restores: await restoresOf(c.env.db, c.req.param('id')) }));

admin.post('/restores/:id/:action{resume|finalize|cancel}', async (c) => {
  const id = Number(c.req.param('id'));
  if (!positive(id)) return fail(c, 400, 'bad-input');
  return answerAction(c, id, c.req.param('action') as RestoreAction);
});

admin.get('/service', async (c) => {
  const row = await c.env.db.prepare(
    `SELECT signup_cap AS signupCap, account_bytes_cap AS accountBytesCap, account_file_bytes_cap AS accountFileBytesCap,
       (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM accounts WHERE state != 'leaving') AS people,
       (SELECT COUNT(*) FROM reports WHERE resolved_at IS NULL) + (SELECT COUNT(*) FROM shares WHERE held_at IS NOT NULL AND removed_at IS NULL) AS pending,
       (SELECT COALESCE(SUM(file_bytes), 0) FROM accounts) AS fileBytes
     FROM service`,
  ).first();
  return c.json({ ...row, ...(await c.env.backups.freshness(c.env, Date.now())) });
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
  const db = c.env.db;
  await db.batch([
    db.prepare(`INSERT INTO admin_log (at, action, target, detail) VALUES (?, 'set-service', 'service', ?)`).bind(Date.now(), JSON.stringify({ signupCap, accountBytesCap, accountFileBytesCap })),
    db.prepare('UPDATE service SET signup_cap = ?, account_bytes_cap = ?, account_file_bytes_cap = ?').bind(signupCap, accountBytesCap, accountFileBytesCap),
  ]);
  return c.body(null, 204);
});

// Newest first. before: the last id of the page before, for the next one. A page shorter than PAGE_ROWS is the last.
// where: what else a row must meet, with its values from ?3 on.
function page(c: Context<AppEnv>, select: string, where = 'TRUE', ...values: SqlValue[]) {
  const before = c.req.query('before');
  if (before !== undefined && !/^[1-9]\d{0,15}$/.test(before)) return null;
  return c.env.db.prepare(`${select} WHERE (?1 IS NULL OR id < ?1) AND ${where} ORDER BY id DESC LIMIT ?2`).bind(before === undefined ? null : Number(before), PAGE_ROWS, ...values);
}

// A share report carries its share's state now and whose it is: held, reviewed (a hold lifted or a block, after which
// reports no longer hold it), cut by the sharer, removed by a block. null: the share went with its sharer's account.
type ShareRow = { held: number; reviewed: number; cut: number; removed: number; ownerId: string | null; ownerName: string | null };
const SHARED = `(SELECT json_object('held', s.held_at IS NOT NULL, 'reviewed', s.reviewed_at IS NOT NULL, 'cut', s.cut_at IS NOT NULL,
    'removed', s.removed_at IS NOT NULL, 'ownerId', a.id, 'ownerName', a.username)
  FROM shares s LEFT JOIN accounts a ON a.incarnation = s.incarnation WHERE s.id = reports.share)`;

admin.get('/reports', async (c) => {
  const rows = page(
    c,
    `SELECT id, account_id AS accountId, username, text, created_at AS createdAt, resolved_at AS resolvedAt, share, share_version AS shareVersion, link, diagnostics,
       ${SHARED} AS shared FROM reports`,
  );
  if (!rows) return fail(c, 400, 'bad-input');
  const { results } = await rows.all<{ share: string | null; shared: string | null }>();
  return c.json({
    reports: results.map(({ shared, ...row }) => {
      const state = shared === null ? null : (JSON.parse(shared) as ShareRow);
      return { ...row, shared: state && { held: Boolean(state.held), reviewed: Boolean(state.reviewed), cut: Boolean(state.cut), removed: Boolean(state.removed), ownerId: state.ownerId, ownerName: state.ownerName } };
    }),
  });
});

// reply: a notice to the report's sender, which must still hold its account: a reply that cannot arrive resolves nothing.
admin.post('/reports/:id/resolve', async (c) => {
  const id = Number(c.req.param('id'));
  const reply = optionalText((await readObject(c))?.reply);
  if (!Number.isSafeInteger(id) || reply === undefined) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const open = reply === null ? 'reports WHERE reports.id = ?1 AND reports.resolved_at IS NULL' : toSender(id).from;
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, 'resolve-report', reports.id FROM ${open}`).bind(id, Date.now()),
    ...(reply === null ? [] : noticed(db, reply, toSender(id), id)),
    db.prepare(`UPDATE reports SET resolved_at = ?2 WHERE id IN (SELECT reports.id FROM ${open}) RETURNING id`).bind(id, Date.now()),
  );
});

admin.route('/', fileBlocks);

// 열어 보기: a share's versions in any state. The report's link holds the key.
admin.get('/shares/:id', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const { results } = await c.env.db.prepare('SELECT version, manifest, created_at AS createdAt FROM share_versions WHERE share = ? ORDER BY version').bind(id).all();
  return results.length ? c.json({ versions: results }) : fail(c, 404, 'not-found');
});

admin.get('/shares/:id/files/:file', (c) => serveShareFile(c, true));

// 보류, with or without a report: both anonymous reads answer held until the operator lifts it or blocks the share.
admin.post('/shares/:id/hold', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const now = Date.now();
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, 'hold-share', id FROM shares WHERE id = ?1 AND held_at IS NULL AND removed_at IS NULL`).bind(id, now),
    db.prepare('UPDATE shares SET held_at = ?2 WHERE id = ?1 AND held_at IS NULL AND removed_at IS NULL RETURNING id').bind(id, now),
  );
});

// 보류 풀기: the link opens again, its open reports are resolved, and it is reviewed: a later report goes to the inbox
// without holding it.
admin.post('/shares/:id/release', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const now = Date.now();
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, 'release-share', id FROM shares WHERE id = ?1 AND removed_at IS NULL`).bind(id, now),
    resolveShareReports(db, id, now),
    db.prepare('UPDATE shares SET held_at = NULL, held_report = NULL, reviewed_at = ?2 WHERE id = ?1 AND removed_at IS NULL RETURNING id').bind(id, now),
  );
});

// 차단: the share is removed, the files of the version reviewed go into file_blocks (every account's copy with them), its
// open reports are resolved, and the sharer is told why and, with suspend, suspended. A share that went with its
// account has no one to tell: not-found.
admin.post('/shares/:id/block', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const version = body?.version;
  const notice = noticeText(body?.notice);
  const suspend = body?.suspend;
  if (!SHARE_ID.test(id) || !positive(version) || !notice || typeof suspend !== 'boolean') return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const owner = await db
    .prepare('SELECT a.id FROM shares s JOIN accounts a ON a.incarnation = s.incarnation WHERE s.id = ? AND s.removed_at IS NULL AND EXISTS (SELECT 1 FROM share_versions WHERE share = s.id AND version = ?)')
    .bind(id, version)
    .first<string>('id');
  if (owner === null) return fail(c, 404, 'not-found');
  const now = Date.now();
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?2, 'block-share', id, json_object('version', ?3) FROM shares WHERE id = ?1 AND removed_at IS NULL`).bind(id, now, version),
    ...blockFiles(db, now, 'SELECT file AS id FROM share_files WHERE share = ?2 AND version = ?3', id, version),
    ...noticed(db, notice, toAccount(owner)),
    ...(suspend ? [logged(db, 'suspend', owner, USERNAME), db.prepare('UPDATE accounts SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL').bind(now, owner)] : []),
    resolveShareReports(db, id, now),
    db.prepare('UPDATE shares SET removed_at = ?2, reviewed_at = ?2 WHERE id = ?1 AND removed_at IS NULL RETURNING id').bind(id, now),
  );
});

const resolveShareReports = (db: Db, share: string, at: number) => db.prepare('UPDATE reports SET resolved_at = ? WHERE share = ? AND resolved_at IS NULL').bind(at, share);

admin.get('/log', async (c) => {
  const rows = page(c, 'SELECT id, at, action, target, detail FROM admin_log');
  if (!rows) return fail(c, 400, 'bad-input');
  const { results } = await rows.all<{ detail: string | null }>();
  return c.json({ log: results.map((row) => ({ ...row, detail: row.detail === null ? null : (JSON.parse(row.detail) as unknown) })) });
});
