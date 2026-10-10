import { Hono } from 'hono';
import { ACCOUNT_USAGE_HEADERS } from '../contracts/http';
import type { FeedQuery, Write } from './account-store';
import { fail, ID, isRecord, readObject, refused, type AppEnv } from './http';
import { store } from './lifecycle';
import { canWrite, requireSession } from './session';

const KIND = /^[a-z][a-z-]{0,31}$/;
// A timeline is 16 random bytes in hex (migrations/0009).
const TIMELINE =/^[0-9a-f]{32}$/;
// bytes: worker.ts enforces it on the whole body, timeline included. The client batches by these, sent with every page.
// The sizes date from the Cloudflare store (a 2 MB row, a 32 MiB RPC).
export const BATCH_LIMITS = { items: 200, bytes: 4_000_000, body: 1_500_000 };

export const objects = new Hono<AppEnv>();

objects.use(requireSession);

// The store keeps the account's objects and answers only on its current timeline (account-store.ts). A device that
// holds nothing yet sends no timeline and adopts the one its first page states.
objects.get('/', async (c) => {
  const since = count(c.req.query('since'));
  const known = count(c.req.query('known') ?? c.req.query('since'));
  const untilAsked = c.req.query('until');
  const until = untilAsked === undefined ? null : count(untilAsked);
  const excluded = c.req.query('exclude')?.split(',') ?? [];
  const parent = c.req.query('parent') ?? null;
  const kind = c.req.query('kind') ?? null;
  const timeline = c.req.query('timeline') ?? null;
  const bootstrap = c.req.query('bootstrap') === '1';
  if (since === null || known === null || (untilAsked !== undefined && (until === null || until < since))) return fail(c, 400, 'bad-input');
  if (excluded.length > 32 || excluded.some((kind) => !KIND.test(kind)) || (parent !== null && !ID.test(parent)) || (kind !== null && !KIND.test(kind)) || (timeline !== null && !TIMELINE.test(timeline))) {
    return fail(c, 400, 'bad-input');
  }
  const query: FeedQuery = { timeline, since, known, until, bootstrap, metadata: c.req.query('metadata') === '1', excluded, parent, kind, count: c.req.query('count') === '1' };
  const account = c.get('account');
  const asked = Date.now();
  const page = await store(c.env, account.incarnation).feed(account.incarnation, query);
  c.set('storeMs', Date.now() - asked);
  if ('refused' in page || 'unavailable' in page) return refused(c, page);
  if ('stale' in page || 'reset' in page) return fail(c, 409, 'cache-reset');
  c.header(ACCOUNT_USAGE_HEADERS.bytes, String(page.bytes));
  return c.json({
    limits: BATCH_LIMITS,
    timeline: page.timeline,
    ...(page.until === null ? {} : { until: page.until }),
    changes: page.changes,
    cursor: page.cursor,
    more: page.more,
    ...(page.total === undefined ? {} : { total: page.total }),
  });
});

objects.post('/batch', canWrite, async (c) => {
  const input = await readObject(c);
  if (!input || typeof input.timeline !== 'string' || !TIMELINE.test(input.timeline) || !Array.isArray(input.writes) || !input.writes.length) {
    return fail(c, 400, 'bad-input');
  }
  if (input.writes.length > BATCH_LIMITS.items) return fail(c, 413, 'too-large');
  const writes: Write[] = [];
  const ids = new Set<string>();
  for (const item of input.writes) {
    const write = readWrite(item);
    if (!write || ids.has(write.id)) return fail(c, 400, 'bad-input');
    if (write.body !== null && Buffer.byteLength(write.body, 'utf8') > BATCH_LIMITS.body) return fail(c, 413, 'too-large');
    ids.add(write.id);
    writes.push(write);
  }
  const account = c.get('account');
  const asked = Date.now();
  const done = await store(c.env, account.incarnation).batch(account.incarnation, input.timeline, writes, account.bytesCap);
  c.set('storeMs', Date.now() - asked);
  if ('revs' in done) {
    c.header(ACCOUNT_USAGE_HEADERS.bytes, String(done.bytes));
    return c.json({ revs: done.revs, timeline: done.timeline });
  }
  if ('stale' in done) return fail(c, 409, 'cache-reset');
  if ('unavailable' in done) return refused(c, done);
  switch (done.refused) {
    case 'bad-input':
      return fail(c, 400, 'bad-input');
    case 'conflict':
      return fail(c, 409, 'conflict');
    case 'storage-full':
      return fail(c, 413, 'storage-full');
    default:
      return refused(c, { refused: done.refused });
  }
});

function count(value: string | undefined): number | null {
  const number = Number(value);
  return value !== undefined && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function readWrite(input: unknown): Write | null {
  if (!isRecord(input)) return null;
  const { id, kind, parent, body, baseRev } = input;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof kind !== 'string' || !KIND.test(kind)) return null;
  if (parent !== null && (typeof parent !== 'string' || !ID.test(parent))) return null;
  if (baseRev !== null && (typeof baseRev !== 'number' || !Number.isSafeInteger(baseRev) || baseRev < 1)) return null;
  if (body !== null && (typeof body !== 'string' || !body)) return null;
  if (body === null && baseRev === null) return null;
  return { id, kind, parent, body, baseRev };
}
