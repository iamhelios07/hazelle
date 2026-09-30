import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fail, hex, readObject, type AppEnv } from './http';
import { requireSession } from './session';

// A file's id is the SHA-256 of its sealed body (vault/files).
export const FILE_ID = /^[0-9a-f]{64}$/;
// Counts sealed bytes, a few more than the file itself.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ASKED = 1000;

// Files are shared by every account that holds the same content, so they live outside any account's keys. Nothing
// removes one yet: a file stays when the last object naming it goes (tech-spec §5).
export const files = new Hono<AppEnv>();

files.use(requireSession);

// Which of the ids the server does not hold, so an import uploads only those.
files.post('/missing', async (c) => {
  const input = await readObject(c);
  const ids = input?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_ASKED || !ids.every((id) => typeof id === 'string' && FILE_ID.test(id))) return fail(c, 400, 'bad-input');
  const { results } = await c.env.DB.prepare('SELECT value AS id FROM json_each(?1) WHERE value NOT IN (SELECT id FROM files)').bind(JSON.stringify(ids)).all<{ id: string }>();
  return c.json({ missing: results.map(({ id }) => id) });
});

// A body that does not hash to its id is refused, so no one can put other bytes under a real file's id. The same file
// uploaded again, by anyone, changes nothing.
files.put('/:id', bodyLimit({ maxSize: MAX_FILE_BYTES, onError: (c) => fail(c, 413, 'too-large') }), async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return fail(c, 400, 'bad-input');
  const body = await c.req.arrayBuffer();
  if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', body))) !== id) return fail(c, 400, 'bad-input');
  if (await c.env.DB.prepare('SELECT 1 FROM files WHERE id = ?').bind(id).first()) return c.body(null, 204);
  await c.env.BLOBS.put(fileKey(id), body);
  await c.env.DB.prepare('INSERT OR IGNORE INTO files (id, size, created_at) VALUES (?, ?, ?)').bind(id, body.byteLength, Date.now()).run();
  return c.body(null, 204);
});

// The id is the content, so the answer never changes and the browser may keep it.
files.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return fail(c, 400, 'bad-input');
  const file = await c.env.BLOBS.get(fileKey(id));
  if (!file) return fail(c, 404, 'not-found');
  return c.body(file.body, 200, { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' });
});

const fileKey = (id: string) => `files/${id}`;
