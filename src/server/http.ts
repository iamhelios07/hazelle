import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AccountState } from '../contracts/admin';
import type { Refused } from './account-store';
import type { Backups } from './backup/backups';
import type { Stores } from './db/account-db';
import type { Db } from './db/service-db';
import type { Bucket } from './files/disk-bucket';
import type { Limiter } from './limits';
import type { Upstream } from './relay';
import type { Streams } from './stream-registry';

// incarnation: the server-made id of the account's data (migrations/0001_baseline.sql). bytesCap: the cap as this
// request's session read it, null for none. admin: the installation row names this account as the operator.
export type Account = { id: string; username: string; suspended: boolean; incarnation: string; state: AccountState; bytesCap: number | null; admin: boolean };
// Account and object ids are UUIDs made by the client.
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// What the process gives every request (node.ts; testing.ts builds the same set over a temp directory). outbound: the
// one way a provider is reached; localProviders: the hosts it reaches outside the public internet (outbound.ts), which
// the session tells the client. limits: calls per account, botCalls per account and chat. backups: the daily job.
export type Services = {
  db: Db;
  files: Bucket;
  stores: Stores;
  streams: Streams;
  outbound: Upstream;
  localProviders: ReadonlySet<string>;
  limits: { calls: Limiter; botCalls: Limiter };
  backups: Backups;
};

export type AppEnv = { Bindings: Services; Variables: { account: Account; storeMs?: number } };

export function fail(c: Context, status: ContentfulStatusCode, error: string, detail: Record<string, unknown> = {}) {
  return c.json({ error, ...detail }, status);
}

const RETRY_SECONDS = 5;

// A leaving or gone account answers as a signed-out one: its session is over.
export function refused(c: Context, answer: Refused) {
  if ('unavailable' in answer) return fail(c, 503, 'store-unavailable', { retryAfter: RETRY_SECONDS });
  return answer.refused === 'restoring' ? fail(c, 503, 'account-restoring', { retryAfter: RETRY_SECONDS }) : fail(c, 401, 'no-session');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return hex(digest);
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readObject(c: Context): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
