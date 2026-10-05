import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { fail, ID, readObject, type AppEnv } from './http';
import { canCall, requireSession } from './session';

const checkId = createMiddleware<AppEnv>(async (c, next) => (ID.test(c.req.param('id') ?? '') ? next() : fail(c, 400, 'bad-id')));
// A stream per account and call: the account's id is in the name so one account never reads another's reply.
const name = (c: Context<AppEnv>) => `${c.get('account').id}:${c.req.param('id')}`;

export const streams = new Hono<AppEnv>()
  .use(requireSession)
  .use('/:id', checkId)
  .use('/:id/*', checkId)
  .post('/:id', canCall, async (c) => {
    const body = await readObject(c);
    if (!body || (body.bot !== undefined && (typeof body.bot !== 'string' || !ID.test(body.bot)))) return fail(c, 400, 'bad-body');
    // bot: the chat whose bot's script asks, as the page states it; a script cannot change what the page sends. The limit
    // stops a script in a loop from spending the user's money unseen.
    if (body.bot !== undefined && !c.env.limits.botCalls.limit(`${c.get('account').id}:${body.bot}`).success) return fail(c, 429, 'too-many-bot-calls');
    return c.env.streams.start(name(c), { id: c.req.param('id')!, key: body.key, request: body.request });
  })
  .get('/:id', (c) => c.env.streams.read(name(c), Number(c.req.query('from') ?? '0') || 0))
  .post('/:id/stop', (c) => {
    c.env.streams.stop(name(c));
    return c.body(null, 204);
  })
  .delete('/:id', async (c) => {
    await c.env.streams.drop(name(c));
    return c.body(null, 204);
  });
