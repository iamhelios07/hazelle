import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { fail, type Account, type AppEnv } from './http';

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * DAY_MS;

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, 'session', 'host');
  const account = token ? await readSession(c.env.DB, token) : null;
  // Carries no x-relay header: that header is how the client tells this 401 from a provider's (tech-spec §6).
  if (!account) return fail(c, 401, 'no-session');
  c.set('account', account);
  await next();
});

export async function startSession(db: D1Database, accountId: string) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const insert = db
    .prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), accountId, Date.now() + SESSION_LIFETIME_MS);
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
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, 'session', { prefix: 'host' });
}

async function readSession(db: D1Database, token: string): Promise<Account | null> {
  const now = Date.now();
  const tokenHash = await sha256(token);
  const row = await db
    .prepare(
      'SELECT a.id, a.username, s.expires_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?',
    )
    .bind(tokenHash, now)
    .first<Account & { expires_at: number }>();
  if (!row) return null;
  // Sliding expiry, written at most once a day rather than on every request.
  if (row.expires_at - now < SESSION_LIFETIME_MS - DAY_MS) {
    await db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_LIFETIME_MS, tokenHash).run();
  }
  return { id: row.id, username: row.username };
}

async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
