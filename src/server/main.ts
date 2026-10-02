// The Worker's entry, the only module wrangler names: Durable Object classes import cloudflare:workers, which the
// vitest server tests (plain Node, through worker.ts) cannot load.
import { sweepDeadPrefixes } from './files';
import app from './worker';

export default {
  fetch: app.fetch,
  scheduled: (_controller, env, ctx) => ctx.waitUntil(sweepDeadPrefixes(env)),
} satisfies ExportedHandler<Env>;

export { AccountStore } from './account-object';
export { Relay } from './relay';
export { ReplyStream } from './streams';
