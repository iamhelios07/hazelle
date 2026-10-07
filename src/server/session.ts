import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import type { AccountState } from '../contracts/admin';
import { ACCOUNT_HEADER } from '../contracts/http';
import { CAP } from './caps';
import type { Db } from './db/service-db';
import { fail, hex, sha256Hex, type Account, type AppEnv } from './http';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * DAY_MS;

// A leaving account has no session: its deletion has begun (lifecycle.ts), and only 탈퇴 itself, run again to finish
// it, is admitted (requireOwnSession).
export async function currentAccount(c: Context<AppEnv>): Promise<Account | null> {
  const account = await sessionAccount(c);
  return account?.state === 'leaving' ? null : account;
}

async function sessionAccount(c: Context<AppEnv>): Promise<Account | null> {
  const token = getCookie(c, 'session', 'host');
  return token ? readSession(c.env.db, token) : null;
}

const sessionGuard = (read: (c: Context<AppEnv>) => Promise<Account | null>) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const account = await read(c);
    // Carries no x-relay header: that header is how the client tells this 401 from a provider's.
    if (!account) return fail(c, 401, 'no-session');
    // A page states the account it holds. Once another tab has signed in as someone else the cookie names that account,
    // and what this page sealed or asks for must not be filed under it. This is the only such check: routes have none.
    // A request stating none is not from a page holding an account: bad input, since a 409 here would close the page's
    // account as if another tab had signed in, and a 401 would say the session is gone.
    const stated = c.req.header(ACCOUNT_HEADER);
    if (stated === undefined) return fail(c, 400, 'bad-input');
    if (stated !== account.id) return fail(c, 409, 'account-mismatch');
    c.set('account', account);
    await next();
  });

export const requireSession = sessionGuard(currentAccount);
// 탈퇴 only: it admits a leaving account too.
export const requireOwnSession = sessionGuard(sessionAccount);

// A suspended account still reads, exports and deletes itself, and adds nothing: canWrite follows requireSession on
// the routes that write objects or upload files, canCall on the ones that call a provider.
export const canWrite = createMiddleware<AppEnv>(async (c, next) => (c.get('account').suspended ? fail(c, 403, 'suspended') : next()));

// Throttling only, per account; a bot's own calls have a narrower key (streams.ts).
const throttle = createMiddleware<AppEnv>(async (c, next) => (c.env.limits.calls.limit(c.get('account').id).success ? next() : fail(c, 429, 'too-many-calls')));

export const canCall = every(canWrite, throttle);

// gated: the insert happens only if the statement before it in the batch wrote a row (signup's account and vault).
export async function startSession(db: Db, accountId: string, gated = false) {
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
  if (token) await c.env.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  dropSessionCookie(c);
}

export function dropSessionCookie(c: Context) {
  deleteCookie(c, 'session', { prefix: 'host' });
}

async function readSession(db: Db, token: string): Promise<Account | null> {
  const now = Date.now();
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT a.id, a.username, a.suspended_at, a.incarnation, a.state, ${CAP.bytes} AS cap, s.expires_at,
         a.id = (SELECT operator_account FROM installation) AS admin
       FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<{ id: string; username: string; suspended_at: number | null; incarnation: string; state: AccountState; cap: number | null; expires_at: number; admin: number }>();
  if (!row) return null;
  // Sliding expiry, written at most once a day rather than on every request.
  if (row.expires_at - now < SESSION_LIFETIME_MS - DAY_MS) {
    await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_LIFETIME_MS, tokenHash).run();
  }
  return { id: row.id, username: row.username, suspended: row.suspended_at !== null, incarnation: row.incarnation, state: row.state, bytesCap: row.cap, admin: row.admin === 1 };
}
