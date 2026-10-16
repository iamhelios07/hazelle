import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { RETRY_MOST, type Retry } from '../contracts/streams';
import { fail, ID, isRecord, readObject, type AppEnv } from './http';
import { botCalls, canCall, requireSession } from './session';

const whole = (value: unknown, least: number, most: number) => Number.isInteger(value) && (value as number) >= least && (value as number) <= most;
const isRetry = (value: unknown): value is Retry => {
  if (!isRecord(value)) return false;
  const { times, statuses } = value;
  return whole(times, 1, RETRY_MOST) && Array.isArray(statuses) && statuses.length <= 20 && statuses.every((status) => whole(status, 100, 599));
};

const checkId = createMiddleware<AppEnv>(async (c, next) => (ID.test(c.req.param('id') ?? '') ? next() : fail(c, 400, 'bad-id')));
// A stream per account and call: the account's id is in the name so one account never reads another's reply.
const name = (c: Context<AppEnv>) => `${c.get('account').id}:${c.req.param('id')}`;

export const streams = new Hono<AppEnv>()
  .use(requireSession)
  .use('/:id', checkId)
  .use('/:id/*', checkId)
  .post('/:id', canCall, async (c) => {
    const body = await readObject(c);
    const retry = body?.retry;
    if (!body || (body.bot !== undefined && (typeof body.bot !== 'string' || !ID.test(body.bot))) || (retry !== undefined && !isRetry(retry))) return fail(c, 400, 'bad-body');
    if (body.bot !== undefined && !botCalls(c, body.bot)) return fail(c, 429, 'too-many-bot-calls');
    return c.env.streams.start(name(c), { id: c.req.param('id')!, key: body.key, request: body.request, ...(retry !== undefined && { retry }) }, c.req.raw.signal);
  })
  .get('/:id', (c) => c.env.streams.read(name(c), Number(c.req.query('from') ?? '0') || 0, c.req.raw.signal))
  .post('/:id/stop', (c) => {
    c.env.streams.stop(name(c));
    return c.body(null, 204);
  })
  .delete('/:id', async (c) => {
    await c.env.streams.drop(name(c));
    return c.body(null, 204);
  });
