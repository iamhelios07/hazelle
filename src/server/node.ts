import { mkdirSync } from 'node:fs';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { serve } from '@hono/node-server';
import { Hono, type ExecutionContext } from 'hono';
import { serviceReads } from './account-store';
import { forgetOldRecords } from './admin';
import { backups } from './backup/backups';
import { listGenerations } from './backup/generation';
import { accountRegistry } from './db/account-db';
import { migrate } from './db/migrate';
import { openDatabase, serviceDb } from './db/service-db';
import { diskBucket } from './files/disk-bucket';
import type { FrontendOptions } from './frontend-worker';
import type { Services } from './http';
import { tokenBucket } from './limits';
import { localProviders, pinnedOutbound } from './outbound';
import { refreshPrices } from './prices';
import { reconcile } from './reconcile';
import { streamRegistry } from './stream-registry';
import { streamStore } from './db/streams-db';
import app from './worker';

// Configuration is the environment (docs/research/docker-port-plan.md §11).
const dataDir = process.env.HAZELLE_DATA ?? '/data';
// An unset or blank variable takes the default: compose passes "" for one the operator left out, and Number("") is 0,
// which would read as a zero-second drain and a midnight snapshot. Anything else must be a whole number in its range,
// or the process refuses to start: an hour of 24 would silently never snapshot.
function wholeFrom(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim() ?? '';
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`hazelle: ${name} must be a whole number from ${min} to ${max}: ${raw}`);
    process.exit(1);
  }
  return value;
}
const port = wholeFrom('PORT', 8080, 1, 65535);
const drainMs = wholeFrom('HAZELLE_DRAIN_SECONDS', 60, 0, 3600) * 1000;
const snapshotHour = wholeFrom('HAZELLE_SNAPSHOT_HOUR', 3, 0, 23);
const alertWebhook = process.env.HAZELLE_ALERT_WEBHOOK || null;
// Two directories up from both src/server/node.ts and dist/server/node.js; a bundle placed elsewhere names them.
const migrationsDir = process.env.HAZELLE_MIGRATIONS ?? join(import.meta.dirname, '..', '..', 'migrations');
const clientDir = process.env.HAZELLE_CLIENT ?? 'dist/client';
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
const local = localProviders(process.env.HAZELLE_LOCAL_PROVIDERS ?? '');
const outbound = pinnedOutbound(local);
const services: Services = {
  db,
  files: diskBucket(dataDir),
  stores: accountRegistry(dataDir, db, serviceReads(db), Date.now),
  streams: streamRegistry(streamStore(join(dataDir, 'streams.sqlite')), outbound),
  outbound,
  localProviders: local,
  limits,
  backups: backups(dataDir, snapshotHour, alertWebhook),
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
root.get('/api/health', async (c) => {
  // Seen only by a request already on an open connection: server.close refuses new connections at once.
  if (draining) return c.json({ ok: false, draining: true }, 503);
  const { backupAgeHours, diskFreePercent } = await services.backups.freshness(services, Date.now());
  return c.json({ ok: true, liveCalls: services.streams.live(), backupAgeHours, diskFreePercent });
});
root.route('/', app);
// An unknown API path is a real 404, never the page.
root.all('/api/*', (c) => c.json({ error: 'not-found' }, 404));

const server = serve({ fetch: (request) => root.fetch(request, services, ctx), hostname: '127.0.0.1', port: 0 }) as Server;
await once(server, 'listening');
// The public listener owns no databases, so even a synchronous SQL operation cannot hold its asset responses.
const frontend = new Worker(new URL(import.meta.url.endsWith('.ts') ? './frontend-worker.ts' : './frontend-worker.js', import.meta.url), {
  workerData: { port, apiPort: (server.address() as AddressInfo).port, clientDir } satisfies FrontendOptions,
});
frontend.on('error', (error) => { log('frontend failed', { error: String(error) }); process.exit(1); });
frontend.on('exit', (code) => { if (!draining) { log('frontend stopped', { code }); process.exit(1); } });
const frontendClosed = new Promise<void>((resolve) => frontend.on('message', (message: string) => { if (message === 'closed') resolve(); }));
await once(frontend, 'message');
log('listening', { port, dataDir, migrationsApplied: applied });

const hourly = () => {
  ctx.waitUntil(refreshPrices(db, outbound));
  ctx.waitUntil(forgetOldRecords(db));
  ctx.waitUntil(reconcile(dataDir, db).then(({ removed }) => removed.length && log('reconciled', { removed })));
};
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
const timers = [
  setInterval(() => {
    if (eventLoop.max > 250_000_000) log('event loop delayed', { maxMs: Math.round(eventLoop.max / 1e6), p99Ms: Math.round(eventLoop.percentile(99) / 1e6), background: background.size });
    eventLoop.reset();
  }, 10_000),
  setInterval(hourly, HOUR_MS),
  setInterval(() => {
    services.stores.evictIdle();
    limits.calls.evict();
    limits.botCalls.evict();
  }, 10 * MINUTE_MS),
  setTimeout(hourly, MINUTE_MS),
  setInterval(() => ctx.waitUntil(services.streams.expire(Date.now())), MINUTE_MS),
  setInterval(() => ctx.waitUntil(services.backups.tick(services, Date.now())), HOUR_MS),
  setTimeout(() => ctx.waitUntil(services.backups.tick(services, Date.now())), MINUTE_MS),
];
for (const timer of timers) timer.unref();

// SIGTERM: stop taking requests, let requests in flight, background work and detached replies finish within the drain,
// then close the databases. server.close settles when the last active request ended. A detached reply still running at
// the deadline is lost: its stored pages stay, and a reader after the restart reads them and then a lost stream.
async function shutdown(signal: string) {
  if (draining) return;
  draining = true;
  const frontendDraining = once(frontend, 'message');
  frontend.postMessage('drain');
  await frontendDraining;
  log('draining', { signal, drainMs });
  for (const timer of timers) clearTimeout(timer);
  eventLoop.disable();
  const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), drainMs).unref());
  const drained = (async () => {
    // The public requests must finish proxying before the API listener stops accepting their connections.
    await frontendClosed;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // A request answered during the wait may have registered more work, and finished work may have chained some.
    while (background.size) await Promise.allSettled([...background]);
    await services.streams.settled();
  })();
  const outcome = await Promise.race([drained.then(() => 'drained' as const), deadline]);
  server.closeAllConnections();
  await frontend.terminate();
  try {
    services.stores.close();
    services.streams.close();
    raw.close();
    lock.close();
  } catch (error) {
    log('close failed', { error: String(error) });
  }
  log('stopped', { outcome, left: background.size });
  process.exit(0);
}
// scripts/deploy.sh asks for a generation before it replaces the image. Without a handler Node's default for the signal
// would end the process with no drain.
// The two log lines are how the script knows its own request was taken and how it ended. Refused once draining: the
// shutdown has stopped looking for new background work.
process.on('SIGUSR2', () => {
  if (draining) return log('backup refused', { reason: 'draining' });
  log('backup requested');
  ctx.waitUntil(
    services.backups.fresh(services).then(async ({ snapshots, generation }) => {
      // Jobs run one at a time, so the newest generation after an ok run is this run's.
      const newest = generation.outcome === 'ok' ? (await listGenerations(dataDir)).sort((a, b) => a.capturedAt - b.capturedAt).at(-1) : undefined;
      log('backup finished', { snapshots: snapshots.outcome, generation: generation.outcome, id: newest?.id ?? null });
    }),
  );
});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
