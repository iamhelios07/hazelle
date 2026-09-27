import { Hono } from 'hono';
import { accounts } from './accounts';
import { fail, type AppEnv } from './http';
import { objects } from './objects';
import { createRelay } from './relay';
import { requireSession } from './session';
import { vaults } from './vaults';

const relay = createRelay(fetch);

const app = new Hono<AppEnv>().basePath('/api');

// Another site cannot send a JSON content type here without a CORS preflight, which this API never
// answers. That makes this a second CSRF guard beside SameSite=Strict.
app.use(async (c, next) => {
  if (c.req.method !== 'GET' && !c.req.header('content-type')?.startsWith('application/json')) {
    return fail(c, 415, 'not-json');
  }
  await next();
});

app.route('/', accounts);
app.route('/vault', vaults);
app.route('/objects', objects);
app.post('/relay', requireSession, (c) => relay(c.req.raw));
app.notFound((c) => fail(c, 404, 'not-found'));

export default app;
