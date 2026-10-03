import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Refused } from './account-store';

export type State = 'active' | 'restoring' | 'leaving';
// incarnation: the server-made id of the account's data (migrations/0009). bytesCap: the cap as this request's session
// read it, null for none.
export type Account = { id: string; username: string; suspended: boolean; incarnation: string; state: State; bytesCap: number | null };
// Account and object ids are UUIDs made by the client.
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type AppEnv = { Bindings: Env; Variables: { account: Account } };

// The operator is the one account this Worker var names, so no stored value can make another.
export const isAdmin = (c: Context<AppEnv>, accountId: string) => accountId === c.env.ADMIN_ACCOUNT;

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
