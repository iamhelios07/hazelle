import { Hono } from 'hono';
import type { FeedQuery, Write } from './account-store';
import { USE_HEADERS } from './caps';
import { FILE_ID } from './files';
import { fail, ID, readObject, refused, type AppEnv } from './http';
import { store } from './lifecycle';
import { canWrite, requireSession } from './session';

const KIND = /^[a-z][a-z-]{0,31}$/;
// A timeline is 16 random bytes in hex (migrations/0009).
export const TIMELINE = /^[0-9a-f]{32}$/;
// The 4 MB HTTP budget, which worker.ts enforces on the whole body, timeline included, stays below Workers' 100 MB
// request and 128 MB memory limits and the store's 32 MiB RPC limit. Each write is its own INSERT in the store's one
// transaction, so a body only has to fit a row (2 MB).
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
  const timeline = c.req.query('timeline') ?? null;
  const bootstrap = c.req.query('bootstrap') === '1';
  if (since === null || known === null || (untilAsked !== undefined && (until === null || until < since))) return fail(c, 400, 'bad-input');
  if (excluded.length > 32 || excluded.some((kind) => !KIND.test(kind)) || (parent !== null && !ID.test(parent)) || (timeline !== null && !TIMELINE.test(timeline))) {
    return fail(c, 400, 'bad-input');
  }
  const query: FeedQuery = { timeline, since, known, until, bootstrap, metadata: c.req.query('metadata') === '1', excluded, parent };
  const account = c.get('account');
  const page = await store(c.env, account.incarnation).feed(account.incarnation, query);
  if ('refused' in page || 'unavailable' in page) return refused(c, page);
  if ('stale' in page || 'reset' in page) return fail(c, 409, 'cache-reset');
  c.header(USE_HEADERS.bytes, String(page.bytes));
  return c.json({
    limits: BATCH_LIMITS,
    timeline: page.timeline,
    ...(page.until === null ? {} : { until: page.until }),
    changes: page.changes,
    cursor: page.cursor,
    more: page.more,
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
    if (write.body !== null && new TextEncoder().encode(write.body).length > BATCH_LIMITS.body) return fail(c, 413, 'too-large');
    ids.add(write.id);
    writes.push(write);
  }
  const account = c.get('account');
  const done = await store(c.env, account.incarnation).batch(account.incarnation, input.timeline, writes, account.bytesCap);
  if ('revs' in done) {
    c.header(USE_HEADERS.bytes, String(done.bytes));
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
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const { id, kind, parent, body, baseRev, file = null } = input as Record<string, unknown>;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof kind !== 'string' || !KIND.test(kind)) return null;
  if (parent !== null && (typeof parent !== 'string' || !ID.test(parent))) return null;
  if (baseRev !== null && (typeof baseRev !== 'number' || !Number.isSafeInteger(baseRev) || baseRev < 1)) return null;
  if (body !== null && (typeof body !== 'string' || !body)) return null;
  if (body === null && baseRev === null) return null;
  if (file !== null && (typeof file !== 'string' || !FILE_ID.test(file))) return null;
  return { id, kind, parent, body, baseRev, file };
}
