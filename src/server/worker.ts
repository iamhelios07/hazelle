import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { accounts } from './accounts';
import { admin, notices, reports } from './admin';
import { files, MAX_FILE_BYTES } from './files';
import { fail, type AppEnv } from './http';
import { BATCH_LIMITS, objects } from './objects';
import { EXIT } from './relay';
import { canCall, requireSession } from './session';
import { streams } from './streams';
import { vaults } from './vaults';

const app = new Hono<AppEnv>().basePath('/api');

// Another site cannot send either content type here without a CORS preflight, which this API never
// answers. That makes this a second CSRF guard beside SameSite=Strict.
const BODY_TYPES = ['application/json', 'application/octet-stream'];

app.use(async (c, next) => {
  const type = c.req.header('content-type');
  if (c.req.method !== 'GET' && !BODY_TYPES.some((allowed) => type?.startsWith(allowed))) {
    return fail(c, 415, 'bad-content-type');
  }
  await next();
});

// Every body is bounded here, before a route reads it, signed in or not. A route that takes more than BODY_BYTES is
// listed. A provider call carries a whole prompt.
const BODY_BYTES = 100_000;
const CALL_BYTES = 32 * 1024 * 1024;
const LARGER: [method: string, path: RegExp, bytes: number][] = [
  ['POST', /^\/api\/objects\/batch$/, BATCH_LIMITS.bytes],
  ['PUT', /^\/api\/files\/[^/]+$/, MAX_FILE_BYTES],
  ['POST', /^\/api\/(relay|streams\/[^/]+)$/, CALL_BYTES],
];

app.use((c, next) => {
  const maxSize = LARGER.find(([method, path]) => method === c.req.method && path.test(c.req.path))?.[2] ?? BODY_BYTES;
  return bodyLimit({ maxSize, onError: () => fail(c, 413, 'too-large') })(c, next);
});

app.route('/', accounts);
app.route('/vault', vaults);
app.route('/objects', objects);
app.route('/files', files);
app.route('/reports', reports);
app.route('/notices', notices);
app.route('/admin', admin);
app.post('/relay', requireSession, canCall, (c) => c.env.RELAY.get(c.env.RELAY.newUniqueId(), EXIT).fetch(c.req.raw));
app.route('/streams', streams);
app.notFound((c) => fail(c, 404, 'not-found'));

export default app;
