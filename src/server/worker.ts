import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { accounts } from './accounts';
import { admin, notices, reports } from './admin';
import { files, MAX_FILE_BYTES } from './files';
import { fail, type AppEnv } from './http';
import { BATCH_LIMITS, objects } from './objects';
import { modelsDev } from './models-dev';
import { PUBLISH_BYTES, shares } from './shares';
import { createRelay } from './relay';
import { canCall, relayBot, requireSession } from './session';
import { streams } from './streams';
import { vaults } from './vaults';

const app = new Hono<AppEnv>().basePath('/api');

// A request this slow is the account store waking (storeMs, set by the objects routes) or the service database answering
// the session row; a provider's own answer time and a picture's upload time are not news.
const SLOW_MS = 5_000;
const OWN_TIME = [/^\/api\/(relay|streams)(\/|$)/, /^\/api\/files\/[^/]+$/];

app.use(async (c, next) => {
  const started = Date.now();
  await next();
  const ms = Date.now() - started;
  if (ms > SLOW_MS && !OWN_TIME.some((path) => path.test(c.req.path))) {
    console.warn('slow request', { method: c.req.method, path: c.req.path, status: c.res.status, ms, storeMs: c.get('storeMs') ?? null });
  }
});

// Hono's own handler would answer a route's exception with plain text, which the browser cannot tell from a page the
// proxy wrote while the app was down (runtime/api): the JSON shape says it was the app, and the log says what broke.
app.onError((error, c) => {
  console.error('request failed', { method: c.req.method, path: c.req.path, error: String(error.stack ?? error) });
  return fail(c, 500, 'server-error');
});

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
  ['POST', /^\/api\/shares(\/[^/]+\/versions)?$/, PUBLISH_BYTES],
];

// bodyLimit trusts Content-Length and passes the stream through, but buffers a chunked body whole before any route
// runs, so an unauthenticated chunked request could hold a route's whole cap in memory per connection. The browser never
// sends a chunked request body.
app.use(async (c, next) => {
  if (c.req.header('transfer-encoding')?.toLowerCase().includes('chunked')) return fail(c, 411, 'length-required');
  const maxSize = LARGER.find(([method, path]) => method === c.req.method && path.test(c.req.path))?.[2] ?? BODY_BYTES;
  return bodyLimit({ maxSize, onError: () => fail(c, 413, 'too-large') })(c, next);
});

app.route('/', accounts);
app.route('/vault', vaults);
app.route('/objects', objects);
app.route('/files', files);
app.route('/shares', shares);
app.route('/reports', reports);
app.route('/notices', notices);
app.route('/admin', admin);
app.route('/models-dev', modelsDev);
app.post('/relay', requireSession, canCall, relayBot, (c) => createRelay(c.env.outbound, c.env.limits.relay.account(c.get('account').id))(c.req.raw));
app.route('/streams', streams);
app.notFound((c) => fail(c, 404, 'not-found'));

export default app;
