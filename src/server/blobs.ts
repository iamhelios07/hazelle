import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fail, ID, type AppEnv } from './http';
import { requireSession } from './session';

// Counts sealed bytes, a few more than the file itself. Room for a large original card image.
const MAX_BLOB_BYTES = 25 * 1024 * 1024;

export const blobs = new Hono<AppEnv>();

blobs.use(requireSession);

blobs.put('/:id', bodyLimit({ maxSize: MAX_BLOB_BYTES, onError: (c) => fail(c, 413, 'too-large') }), async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return fail(c, 400, 'bad-input');
  await c.env.BLOBS.put(blobKey(c, id), await c.req.arrayBuffer());
  return c.body(null, 204);
});

blobs.get('/:id', async (c) => {
  const blob = await c.env.BLOBS.get(blobKey(c, c.req.param('id')));
  if (!blob) return fail(c, 404, 'not-found');
  return c.body(blob.body, 200, { 'content-type': 'application/octet-stream' });
});

blobs.delete('/:id', async (c) => {
  await c.env.BLOBS.delete(blobKey(c, c.req.param('id')));
  return c.body(null, 204);
});

// Every key starts with the session's account, so no account can reach another's blobs.
function blobKey(c: Context<AppEnv>, id: string) {
  return `${c.get('account').id}/${id}`;
}
