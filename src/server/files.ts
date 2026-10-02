import { Hono } from 'hono';
import { CAP, USE_HEADERS } from './caps';
import { fail, hex, readObject, type AppEnv } from './http';
import { canWrite, requireSession } from './session';

// A file's id is the SHA-256 of its sealed body (vault/files).
export const FILE_ID = /^[0-9a-f]{64}$/;
// Counts sealed bytes, a few more than the file itself. worker.ts enforces it.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ASKED = 1000;

// Files are shared by every account that holds the same content, so they live outside any account's keys. Nothing
// removes one yet: a file stays when the last object naming it goes (tech-spec §5).
export const files = new Hono<AppEnv>();

files.use(requireSession);

// Which of the ids the server does not hold, so an import uploads only those. A blocked id counts as not held: the
// upload is then refused by name, where 'held' would let an object name a file nobody can read.
files.post('/missing', async (c) => {
  const input = await readObject(c);
  const ids = input?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_ASKED || !ids.every((id) => typeof id === 'string' && FILE_ID.test(id))) return fail(c, 400, 'bad-input');
  const { results } = await c.env.DB.prepare('SELECT value AS id FROM json_each(?1) WHERE value NOT IN (SELECT id FROM files WHERE blocked_at IS NULL)').bind(JSON.stringify(ids)).all<{ id: string }>();
  return c.json({ missing: results.map(({ id }) => id) });
});

// A body that does not hash to its id is refused, so no one can put other bytes under a real file's id. The same file
// uploaded again, by anyone, changes nothing.
// The account that first stores a file pays its bytes into accounts.file_bytes, before they are stored, so a refused
// upload stores nothing and the server holds no more than the accounts' caps allow. A file held already costs nothing.
files.put('/:id', canWrite, async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return fail(c, 400, 'bad-input');
  const held = await c.env.DB.prepare('SELECT blocked_at FROM files WHERE id = ?').bind(id).first<{ blocked_at: number | null }>();
  if (held?.blocked_at) return fail(c, 403, 'file-blocked');
  const body = await c.req.arrayBuffer();
  if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', body))) !== id) return fail(c, 400, 'bad-input');
  if (held) return c.body(null, 204);
  const db = c.env.DB;
  const account = c.get('account').id;
  const size = body.byteLength;
  const charged = await db
    .prepare(`UPDATE accounts SET file_bytes = file_bytes + ?2 WHERE id = ?1 AND COALESCE(file_bytes + ?2 <= ${CAP.fileBytes}, 1) RETURNING file_bytes`)
    .bind(account, size)
    .first<number>('file_bytes');
  if (charged === null) return fail(c, 413, 'files-full');
  try {
    await c.env.BLOBS.put(fileKey(id), body);
  } catch (error) {
    await db.prepare('UPDATE accounts SET file_bytes = file_bytes - ?2 WHERE id = ?1').bind(account, size).run();
    throw error;
  }
  // Another account storing the same file at once may insert it first, and then pays for it alone.
  const [, refunded] = await db.batch<{ file_bytes: number }>([
    db.prepare('INSERT OR IGNORE INTO files (id, size, created_at) VALUES (?, ?, ?)').bind(id, size, Date.now()),
    db.prepare('UPDATE accounts SET file_bytes = file_bytes - ?2 WHERE id = ?1 AND changes() = 0 RETURNING file_bytes').bind(account, size),
  ]);
  c.header(USE_HEADERS.fileBytes, String(refunded!.results[0]?.file_bytes ?? charged));
  return c.body(null, 204);
});

// The id is the content, so the answer never changes and the browser may keep it. A block therefore stops only
// browsers that have not read the file yet.
files.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return fail(c, 400, 'bad-input');
  const [file, blocked] = await Promise.all([
    c.env.BLOBS.get(fileKey(id)),
    c.env.DB.prepare('SELECT 1 FROM files WHERE id = ? AND blocked_at IS NOT NULL').bind(id).first(),
  ]);
  if (blocked) {
    void file?.body.cancel();
    return fail(c, 403, 'file-blocked');
  }
  if (!file) return fail(c, 404, 'not-found');
  return c.body(file.body, 200, { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' });
});

const fileKey = (id: string) => `files/${id}`;
