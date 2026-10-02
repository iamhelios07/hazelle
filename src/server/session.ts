import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import { CAP } from './caps';
import { fail, hex, sha256Hex, type Account, type AppEnv, type State } from './http';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * DAY_MS;

export async function currentAccount(c: Context<AppEnv>): Promise<Account | null> {
  const token = getCookie(c, 'session', 'host');
  return token ? readSession(c.env.DB, token) : null;
}

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const account = await currentAccount(c);
  // Carries no x-relay header: that header is how the client tells this 401 from a provider's.
  if (!account) return fail(c, 401, 'no-session');
  // A page states the account it holds. Once another tab has signed in as someone else the cookie names that account,
  // and what this page sealed or asks for must not be filed under it. This is the only such check: routes have none.
  // A request stating none is not from a page holding an account: bad input, since a 409 here would close the page's
  // account as if another tab had signed in, and a 401 would say the session is gone.
  const stated = c.req.header('x-account');
  if (stated === undefined) return fail(c, 400, 'bad-input');
  if (stated !== account.id) return fail(c, 409, 'account-mismatch');
  c.set('account', account);
  await next();
});

// A suspended account still reads, exports and deletes itself, and adds nothing: canWrite follows requireSession on
// the routes that write objects or upload files, canCall on the ones that call a provider.
export const canWrite = createMiddleware<AppEnv>(async (c, next) => (c.get('account').suspended ? fail(c, 403, 'suspended') : next()));

// Throttling only: the binding counts per Cloudflare location and is eventually consistent, so it accounts for nothing.
// The key is the account alone. A narrower key (account:chat:purpose) takes a binding of its own: a binding has one limit.
const throttle = createMiddleware<AppEnv>(async (c, next) => {
  const { success } = await c.env.CALLS.limit({ key: c.get('account').id });
  return success ? next() : fail(c, 429, 'too-many-calls');
});

export const canCall = every(canWrite, throttle);

// gated: the insert happens only if the statement before it in the batch wrote a row (signup's account and vault).
export async function startSession(db: D1Database, accountId: string, gated = false) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const insert = db
    .prepare(`INSERT INTO sessions (token_hash, account_id, expires_at) SELECT ?, ?, ?${gated ? ' WHERE changes() = 1' : ''}`)
    .bind(await sha256Hex(token), accountId, Date.now() + SESSION_LIFETIME_MS);
  return { token, insert };
}

export function setSessionCookie(c: Context, token: string) {
  // The database expiry is the real limit. The cookie only has to outlive it, and 400 days is the browser cap.
  setCookie(c, 'session', token, {
    prefix: 'host',
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: 400 * 24 * 60 * 60,
  });
}

export async function endSession(c: Context<AppEnv>) {
  const token = getCookie(c, 'session', 'host');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  dropSessionCookie(c);
}

export function dropSessionCookie(c: Context) {
  deleteCookie(c, 'session', { prefix: 'host' });
}

async function readSession(db: D1Database, token: string): Promise<Account | null> {
  const now = Date.now();
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT a.id, a.username, a.suspended_at, a.incarnation, a.state, ${CAP.bytes} AS cap, s.expires_at
       FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<{ id: string; username: string; suspended_at: number | null; incarnation: string; state: State; cap: number | null; expires_at: number }>();
  if (!row) return null;
  // Sliding expiry, written at most once a day rather than on every request.
  if (row.expires_at - now < SESSION_LIFETIME_MS - DAY_MS) {
    await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_LIFETIME_MS, tokenHash).run();
  }
  return { id: row.id, username: row.username, suspended: row.suspended_at !== null, incarnation: row.incarnation, state: row.state, bytesCap: row.cap };
}
