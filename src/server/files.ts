import { Hono } from 'hono';
import { CAP, USE_HEADERS } from './caps';
import { fail, hex, readObject, type AppEnv } from './http';
import { canWrite, requireSession } from './session';

// A file's id is the SHA-256 of its sealed body (vault/files).
export const FILE_ID = /^[0-9a-f]{64}$/;
// Counts sealed bytes, a few more than the file itself. worker.ts enforces it.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ASKED = 1000;

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
    `SELECT asked.value AS id FROM json_each(?2) AS asked
     WHERE NOT EXISTS (SELECT 1 FROM account_files WHERE incarnation = ?1 AND id = asked.value AND stored = 1) OR value IN (SELECT id FROM file_blocks)`,
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
  const [, , reserved] = await db.batch([
    db
      .prepare(
        `INSERT INTO account_files (incarnation, id, size, created_at)
         SELECT incarnation, ?2, ?3, ?4 FROM accounts WHERE incarnation = ?1 AND COALESCE(file_bytes + ?3 <= ${CAP.fileBytes}, 1)
         ON CONFLICT DO NOTHING`,
      )
      .bind(incarnation, id, body.byteLength, Date.now()),
    // The batch is one transaction: only an actually inserted reservation charges bytes. Existing reservations
    // remain retryable even after the cap is lowered. Deletion removes both the account's counter and its file rows.
    db.prepare('UPDATE accounts SET file_bytes = file_bytes + ?2 WHERE incarnation = ?1 AND changes() = 1').bind(incarnation, body.byteLength),
    db.prepare('SELECT 1 FROM account_files WHERE incarnation = ? AND id = ?').bind(incarnation, id),
  ]);
  if (!reserved!.results.length) return fail(c, 413, 'files-full');
  await c.env.BLOBS.put(fileKey(incarnation, id), body);
  const fileBytes = await db
    .prepare(`UPDATE account_files SET stored = 1 WHERE incarnation = ?1 AND id = ?2 RETURNING (SELECT file_bytes FROM accounts WHERE incarnation = ?1) AS fileBytes`)
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

const CLEANUP_PAGE = 1000;
const CLEANUP_BUDGET = 20;

// Safe to repeat: the account's deletion reruns it after a crash (lifecycle.ts). Finish this direct request: leaving
// accounts cannot sign in again, so a scheduled-work budget must not deliberately strand their own deletion.
export async function removeAccountFiles(env: Env, incarnation: string): Promise<void> {
  for (;;) {
    if (await removePrefixPage(env.BLOBS, `files/${incarnation}/`)) return;
  }
}

// Removes the pictures of every incarnation that has no account: bytes an upload put after its account's deletion
// removed the prefix. R2 is listed before D1 is read, so a listed prefix of a live account had its row already: a
// prefix appears only after a put, which follows its account's signup.
export async function sweepDeadPrefixes(env: Env): Promise<void> {
  let pages = CLEANUP_BUDGET;
  let finished = false;
  while (pages > 0) {
    const { results: queued } = await env.DB.prepare('SELECT prefix FROM file_cleanup ORDER BY prefix LIMIT ?').bind(CLEANUP_PAGE).all<{ prefix: string }>();
    for (const { prefix } of queued) {
      let emptied = false;
      while (pages > 0 && !emptied) {
        pages--;
        emptied = await removePrefixPage(env.BLOBS, prefix);
      }
      if (!emptied) return;
      await env.DB.prepare('DELETE FROM file_cleanup WHERE prefix = ?').bind(prefix).run();
      if (pages === 0) return;
    }
    if (finished) return;
    const after = (await env.DB.prepare('SELECT after_key FROM file_sweep WHERE singleton = 1').first<string>('after_key'))!;
    const page = await env.BLOBS.list({ prefix: 'files/', delimiter: '/', startAfter: after || undefined, limit: CLEANUP_PAGE });
    pages--;
    const prefixes = page.delimitedPrefixes;
    // Incarnations are 32 lowercase hex digits (signup) and keys under them are file hashes. Replacing the slash
    // after one incarnation with '0' sorts after EVERY key of that incarnation and before EVERY later incarnation.
    // This lexical bound remains valid when prefixes disappear: unlike an R2 cursor, it names no deleted listing.
    // Bare keys directly under files/ (the pre-0009 shared layout, files/<64 hex>) arrive in objects and count toward
    // the limit, so a page can hold no prefix: the marker is the later of both ends, or such a page stalls it.
    const ends = [...prefixes.map((prefix) => `${prefix.slice(0, -1)}0`), ...page.objects.map(({ key }) => key)];
    const next = page.truncated ? ends.sort().at(-1)! : '';
    await env.DB.batch([
      // Check only the listed incarnations, after the listing. Never reuse an all-account snapshot here. The
      // queue and marker commit together, so a crash cannot skip a prefix; concurrent sweeps use the same CAS.
      // Advancing requires an empty queue, so overlapping runs cannot accumulate more than one prefix page.
      env.DB.prepare(`UPDATE file_sweep SET after_key = ?1
        WHERE singleton = 1 AND after_key = ?2 AND NOT EXISTS (SELECT 1 FROM file_cleanup)`).bind(next, after),
      env.DB.prepare(`INSERT INTO file_cleanup (prefix)
        SELECT value FROM json_each(?1) WHERE changes() = 1
          AND NOT EXISTS (SELECT 1 FROM accounts WHERE incarnation = substr(value, 7, 32))
        ON CONFLICT DO NOTHING`).bind(JSON.stringify(prefixes)),
    ]);
    // The last listing's work remains durable if this invocation spends its budget before deleting it. Stop after
    // a complete scan so a service containing only live prefixes does not loop on its first page forever.
    finished = !page.truncated;
  }
}

// Re-list the first bounded page after deleting it: no cursor survives deletion of its keys. One delete takes at
// most 1,000 keys. A partial prefix stays in the durable queue, and repeating a delete after a crash is harmless.
async function removePrefixPage(blobs: R2Bucket, prefix: string): Promise<boolean> {
  const page = await blobs.list({ prefix, limit: CLEANUP_PAGE });
  if (page.objects.length) await blobs.delete(page.objects.map(({ key }) => key));
  return !page.truncated;
}

const fileKey = (incarnation: string, id: string) => `files/${incarnation}/${id}`;
