import { Hono } from 'hono';
import { CAP, USE_HEADERS } from './caps';
import { fail, hex, readObject, type AppEnv } from './http';
import { canWrite, requireSession } from './session';

// A file's id is the SHA-256 of its sealed body (vault/files).
export const FILE_ID = /^[0-9a-f]{64}$/;
// Counts sealed bytes, a few more than the file itself. worker.ts enforces it.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ASKED = 1000;

// An account's picture bytes, as SQL in a statement over its accounts row: the sum of its own rows, stored or still
// reserved, each file once. The one count of them; no stored counter is kept beside it.
export const FILE_BYTES = '(SELECT COALESCE(SUM(size), 0) FROM account_files WHERE incarnation = accounts.incarnation)';

// Each account holds its own copy of a file under its incarnation, so nothing is shared between accounts and removing
// one account's pictures races no one else. Nothing removes a file while its account lives: an import asks /missing
// before the objects naming the file are written (runtime/files), and a restore may bring back an object naming it.
export const files = new Hono<AppEnv>();

files.use(requireSession);

// Which of the ids the asking account does not hold, so an import uploads only those, and the largest body a PUT
// takes, so the client sends none past it: worker.ts refuses one before reading it, which the browser reports as a
// dropped connection, not as the 413. A blocked id counts as not held: the upload is then refused by name, where
// 'held' would let an object name a file nobody can read.
files.post('/missing', async (c) => {
  const input = await readObject(c);
  const ids = input?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_ASKED || !ids.every((id) => typeof id === 'string' && FILE_ID.test(id))) return fail(c, 400, 'bad-input');
  const { results } = await c.env.DB.prepare(
    `SELECT value AS id FROM json_each(?2)
     WHERE value NOT IN (SELECT id FROM account_files WHERE incarnation = ?1 AND stored = 1) OR value IN (SELECT id FROM file_blocks)`,
  )
    .bind(c.get('account').incarnation, JSON.stringify(ids))
    .all<{ id: string }>();
  return c.json({ missing: results.map(({ id }) => id), maxBytes: MAX_FILE_BYTES });
});

// A body that does not hash to its id is refused: a block names content across every account and GET's answer is
// cached forever, both only because an id is its content.
// Reserve, put, finalize: the row is written, and counted, before the bytes, so the cap holds against a crash at any
// point, and a retry of the same file reuses its row instead of paying again. An upload whose account was deleted
// meanwhile, or replaced by a signup reusing its id, names the old incarnation: its statements match no row, and the
// bytes it left under the old prefix are removed by sweepDeadPrefixes.
files.put('/:id', canWrite, async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  const { incarnation } = c.get('account');
  // The body is read before any refusal: one answered while it is still being sent reaches the browser as a dropped
  // connection, which the client would wait out instead of taking the answer.
  const [held, body] = await Promise.all([
    db
      .prepare('SELECT EXISTS (SELECT 1 FROM file_blocks WHERE id = ?2) AS blocked, (SELECT stored FROM account_files WHERE incarnation = ?1 AND id = ?2) AS stored')
      .bind(incarnation, id)
      .first<{ blocked: number; stored: number | null }>(),
    c.req.arrayBuffer(),
  ]);
  if (held!.blocked) return fail(c, 403, 'file-blocked');
  if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', body))) !== id) return fail(c, 400, 'bad-input');
  if (held!.stored) return c.body(null, 204);
  const [, reserved] = await db.batch([
    db
      .prepare(
        `INSERT INTO account_files (incarnation, id, size, created_at)
         SELECT incarnation, ?2, ?3, ?4 FROM accounts WHERE incarnation = ?1 AND COALESCE(${FILE_BYTES} + ?3 <= ${CAP.fileBytes}, 1)
         ON CONFLICT DO NOTHING`,
      )
      .bind(incarnation, id, body.byteLength, Date.now()),
    db.prepare('SELECT 1 FROM account_files WHERE incarnation = ? AND id = ?').bind(incarnation, id),
  ]);
  if (!reserved!.results.length) return fail(c, 413, 'files-full');
  await c.env.BLOBS.put(fileKey(incarnation, id), body);
  const fileBytes = await db
    .prepare(`UPDATE account_files SET stored = 1 WHERE incarnation = ?1 AND id = ?2 RETURNING (SELECT ${FILE_BYTES} FROM accounts WHERE incarnation = ?1) AS fileBytes`)
    .bind(incarnation, id)
    .first<number>('fileBytes');
  // Only the account's deletion removes its rows, so a finalize that matches none is a request outliving its account.
  if (fileBytes === null) return fail(c, 401, 'no-session');
  c.header(USE_HEADERS.fileBytes, String(fileBytes));
  return c.body(null, 204);
});

// The id is the content, so the answer never changes and the browser may keep it. A block therefore stops only
// browsers that have not read the file yet.
files.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return fail(c, 400, 'bad-input');
  const { incarnation } = c.get('account');
  const [file, held] = await Promise.all([
    c.env.BLOBS.get(fileKey(incarnation, id)),
    c.env.DB.prepare('SELECT EXISTS (SELECT 1 FROM file_blocks WHERE id = ?2) AS blocked, EXISTS (SELECT 1 FROM account_files WHERE incarnation = ?1 AND id = ?2 AND stored = 1) AS stored')
      .bind(incarnation, id)
      .first<{ blocked: number; stored: number }>(),
  ]);
  if (held!.blocked || !held!.stored || !file) {
    void file?.body.cancel();
    return held!.blocked ? fail(c, 403, 'file-blocked') : fail(c, 404, 'not-found');
  }
  return c.body(file.body, 200, { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' });
});

// The operator's block, mounted under the operator's guard (admin.ts). It refuses the content to every account and
// needs no account to hold it. No bytes are removed, so lifting it brings every copy back.
// The admin_log row goes in one batch with the change, before it and only if the change happens, so the log never
// misses a change that happened and never holds one that did not.
export const fileBlocks = new Hono<AppEnv>().put('/files/:id/blocked', async (c) => {
  const id = c.req.param('id');
  const blocked = (await readObject(c))?.blocked;
  if (!FILE_ID.test(id) || typeof blocked !== 'boolean') return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  const at = Date.now();
  await db.batch(
    blocked
      ? [
          db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?1, 'block-file', ?2 WHERE NOT EXISTS (SELECT 1 FROM file_blocks WHERE id = ?2)`).bind(at, id),
          db.prepare('INSERT INTO file_blocks (id, blocked_at) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(id, at),
        ]
      : [
          db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?1, 'unblock-file', id FROM file_blocks WHERE id = ?2`).bind(at, id),
          db.prepare('DELETE FROM file_blocks WHERE id = ?').bind(id),
        ],
  );
  return c.body(null, 204);
});

// Safe to repeat: the account's deletion reruns it after a crash (lifecycle.ts).
export async function removeAccountFiles(env: Env, incarnation: string): Promise<void> {
  await removePrefix(env.BLOBS, `files/${incarnation}/`);
}

// Removes the pictures of every incarnation that has no account: bytes an upload put after its account's deletion
// removed the prefix. R2 is listed before D1 is read, so a listed prefix of a live account had its row already: a
// prefix appears only after a put, which follows its account's signup.
export async function sweepDeadPrefixes(env: Env): Promise<void> {
  const listed: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BLOBS.list({ prefix: 'files/', delimiter: '/', cursor });
    listed.push(...page.delimitedPrefixes);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const { results } = await env.DB.prepare('SELECT incarnation FROM accounts').all<{ incarnation: string }>();
  const live = new Set(results.map(({ incarnation }) => `files/${incarnation}/`));
  for (const prefix of listed) if (!live.has(prefix)) await removePrefix(env.BLOBS, prefix);
}

// Collects every key before deleting any, so no page is listed from a cursor whose keys were deleted under it. One
// delete takes at most 1,000 keys.
async function removePrefix(blobs: R2Bucket, prefix: string) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await blobs.list({ prefix, cursor });
    keys.push(...page.objects.map(({ key }) => key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let start = 0; start < keys.length; start += 1000) await blobs.delete(keys.slice(start, start + 1000));
}

const fileKey = (incarnation: string, id: string) => `files/${incarnation}/${id}`;
