import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { fail, ID, readObject, type AppEnv } from './http';
import { EXIT } from './relay';
import { StreamBox, type Live } from './stream-box';
import { canCall, requireSession } from './session';

// name: the object's, `account:call` (box below). A failed write leaves the count wrong, never the call.
export function liveCall(db: D1Database, name: string): Live {
  const at = name.indexOf(':');
  const key = [name.slice(0, at), name.slice(at + 1)];
  let began = Promise.resolve();
  return {
    began: () => {
      began = db.prepare('INSERT INTO live_calls (account, call, started_at) VALUES (?, ?, ?)').bind(...key, Date.now()).run().then(() => {}, () => {});
    },
    ended: () =>
      began
        .then(() => db.prepare('DELETE FROM live_calls WHERE account = ? AND call = ?').bind(...key).run())
        .then(() => {}, () => {}),
  };
}

export class ReplyStream {
  private readonly box: StreamBox;

  constructor(state: DurableObjectState, env: Env) {
    // id.name is set inside the object only because box() gets it by idFromName.
    this.box = new StreamBox(state.storage, fetch, liveCall(env.DB, state.id.name!));
  }

  fetch(request: Request) {
    return this.box.handle(request);
  }

  alarm() {
    return this.box.expire();
  }
}

const checkId = createMiddleware<AppEnv>(async (c, next) => (ID.test(c.req.param('id') ?? '') ? next() : fail(c, 400, 'bad-id')));
const box = (c: Context<AppEnv>) => c.env.STREAMS.get(c.env.STREAMS.idFromName(`${c.get('account').id}:${c.req.param('id')}`), EXIT);

export const streams = new Hono<AppEnv>()
  .use(requireSession)
  .use('/:id', checkId)
  .use('/:id/*', checkId)
  .post('/:id', canCall, async (c) => {
    const body = await readObject(c);
    if (!body || (body.bot !== undefined && (typeof body.bot !== 'string' || !ID.test(body.bot)))) return fail(c, 400, 'bad-body');
    // bot: the chat whose bot's script asks, as the page states it; a script cannot change what the page sends. The
    // binding counts per location and eventually: it stops a script in a loop, it counts nothing exactly.
    if (body.bot !== undefined && !(await c.env.BOT_CALLS.limit({ key: `${c.get('account').id}:${body.bot}` })).success) return fail(c, 429, 'too-many-bot-calls');
    return box(c).fetch('https://stream/start', { method: 'POST', body: JSON.stringify({ id: c.req.param('id'), key: body.key, request: body.request }) });
  })
  .get('/:id', (c) => box(c).fetch(`https://stream/read?from=${Number(c.req.query('from') ?? '0') || 0}`))
  .post('/:id/stop', (c) => box(c).fetch('https://stream/stop', { method: 'POST' }))
  .delete('/:id', (c) => box(c).fetch('https://stream/', { method: 'DELETE' }));
