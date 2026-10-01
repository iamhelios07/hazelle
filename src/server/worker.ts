import { Hono } from 'hono';
import { accounts } from './accounts';
import { files } from './files';
import { fail, type AppEnv } from './http';
import { objects } from './objects';
import { EXIT } from './relay';
import { requireSession } from './session';
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

app.route('/', accounts);
app.route('/vault', vaults);
app.route('/objects', objects);
app.route('/files', files);
app.post('/relay', requireSession, (c) => c.env.RELAY.get(c.env.RELAY.newUniqueId(), EXIT).fetch(c.req.raw));
app.route('/streams', streams);
app.notFound((c) => fail(c, 404, 'not-found'));

export default app;
export { Relay } from './relay';
export { ReplyStream } from './streams';
