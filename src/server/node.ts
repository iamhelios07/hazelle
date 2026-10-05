import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type ExecutionContext } from 'hono';
import { serviceReads } from './account-store';
import { forgetOldRecords } from './admin';
import { accountRegistry } from './db/account-db';
import { migrate } from './db/migrate';
import { openDatabase, serviceDb } from './db/service-db';
import { diskBucket } from './files/disk-bucket';
import type { Services } from './http';
import { tokenBucket } from './limits';
import { localProviders, pinnedOutbound } from './outbound';
import { refreshPrices } from './prices';
import { reconcile } from './reconcile';
import { streamRegistry } from './stream-registry';
import { streamStore } from './db/streams-db';
import app from './worker';

// The process: one data directory, one owner, the services every request gets, the schedulers, and a shutdown that
// drains before it closes the databases. Configuration is the environment (docs/research/docker-port-plan.md §11).
const dataDir = process.env.HAZELLE_DATA ?? '/data';
const port = Number(process.env.PORT ?? 8080);
const drainMs = Number(process.env.HAZELLE_DRAIN_SECONDS ?? 60) * 1000;
// Two directories up from both src/server/node.ts and dist/server/node.js; a bundle placed elsewhere names them.
const migrationsDir = process.env.HAZELLE_MIGRATIONS ?? join(import.meta.dirname, '..', '..', 'migrations');
const clientDir = 'dist/client';
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const log = (event: string, detail: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

mkdirSync(dataDir, { recursive: true });

// The per-account registry lives in this process's memory, so a second process on the directory would corrupt the
// ordering it promises. An exclusive transaction held open on lock.sqlite is an OS lock the kernel drops when the process
// dies, which a lock file would not be.
const lock = new DatabaseSync(join(dataDir, 'lock.sqlite'));
try {
  lock.exec('BEGIN EXCLUSIVE');
} catch {
  console.error(`hazelle: another process holds ${dataDir}`);
  process.exit(1);
}

const raw = openDatabase(join(dataDir, 'service.sqlite'));
const { applied } = migrate(raw, migrationsDir);
const db = serviceDb(raw);
const limits = { calls: tokenBucket(240), botCalls: tokenBucket(20) };
const outbound = pinnedOutbound(localProviders(process.env.HAZELLE_LOCAL_PROVIDERS ?? ''));
const services: Services = {
  db,
  files: diskBucket(dataDir),
  stores: accountRegistry(dataDir, db, serviceReads(db), Date.now),
  streams: streamRegistry(streamStore(join(dataDir, 'streams.sqlite')), outbound),
  outbound,
  limits,
};

// Work a request leaves running after its answer; the shutdown waits for it.
const background = new Set<Promise<unknown>>();
const ctx: ExecutionContext = {
  waitUntil: (work) => {
    background.add(work);
    work.catch((error: unknown) => log('background failed', { error: String(error) })).finally(() => background.delete(work));
  },
  passThroughOnException: () => {},
  props: {},
};

let draining = false;
const root = new Hono();
root.get('/api/health', (c) => (draining ? c.json({ ok: false, draining: true }, 503) : c.json({ ok: true, liveCalls: services.streams.live() })));
root.route('/', app);
// An unknown API path is a real 404, never the page.
root.all('/api/*', (c) => c.json({ error: 'not-found' }, 404));
root.use('*', serveStatic({ root: clientDir }));
root.get('*', serveStatic({ root: clientDir, path: 'index.html' }));

const server = serve({ fetch: (request) => root.fetch(request, services, ctx), port }, () => log('listening', { port, dataDir, migrationsApplied: applied })) as Server;

const hourly = () => {
  ctx.waitUntil(refreshPrices(db, outbound));
  ctx.waitUntil(forgetOldRecords(db));
  ctx.waitUntil(reconcile(dataDir, db).then(({ removed }) => removed.length && log('reconciled', { removed })));
};
const timers = [
  setInterval(hourly, HOUR_MS),
  setInterval(() => {
    services.stores.evictIdle();
    limits.calls.evict();
    limits.botCalls.evict();
  }, 10 * MINUTE_MS),
  setTimeout(hourly, MINUTE_MS),
  setInterval(() => ctx.waitUntil(services.streams.expire(Date.now())), MINUTE_MS),
];
for (const timer of timers) timer.unref();

// SIGTERM: stop taking requests, let requests in flight, background work and detached replies finish within the drain,
// then close the databases. server.close settles when the last active request ended. A detached reply still running at
// the deadline is lost: its stored pages stay, and a reader after the restart reads them and then a lost stream.
async function shutdown(signal: string) {
  if (draining) return;
  draining = true;
  log('draining', { signal, drainMs });
  for (const timer of timers) clearTimeout(timer);
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  // A keep-alive connection that keeps asking is never idle at one instant; it is closed between its requests.
  const sweeping = setInterval(() => server.closeIdleConnections(), 100);
  const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), drainMs).unref());
  const outcome = await Promise.race([Promise.all([closed, Promise.allSettled([...background]), services.streams.settled()]).then(() => 'drained' as const), deadline]);
  clearInterval(sweeping);
  server.closeAllConnections();
  services.stores.close();
  services.streams.close();
  raw.close();
  lock.close();
  log('stopped', { outcome, left: background.size });
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
