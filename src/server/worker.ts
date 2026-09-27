import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { hashPassword, verifyPassword } from './password';
import { createRelay } from './relay';

type Account = { id: string; username: string };
type AppEnv = { Bindings: Env; Variables: { account: Account } };

const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_LIFETIME_MS = 30 * DAY_MS;
const USERNAME = /^[\p{L}\p{N}_.-]{2,32}$/u;
const MIN_PASSWORD_LENGTH = 8;
const FREE_FAILURES = 5;
const MAX_LOCK_MINUTES = 60;

const relay = createRelay(fetch);

const app = new Hono<AppEnv>().basePath('/api');

// Another site cannot send a JSON content type here without a CORS preflight, which this API never
// answers. That makes this a second CSRF guard beside SameSite=Strict.
app.use(async (c, next) => {
  if (c.req.method !== 'GET' && !c.req.header('content-type')?.startsWith('application/json')) {
    return fail(c, 415, 'not-json');
  }
  await next();
});

const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, 'session', 'host');
  const account = token ? await readSession(c.env.DB, token) : null;
  // Carries no x-relay header: that header is how the client tells this 401 from a provider's (tech-spec §6).
  if (!account) return fail(c, 401, 'no-session');
  c.set('account', account);
  await next();
});

app.get('/signup', async (c) => c.json({ open: await signupOpen(c.env.DB) }));

app.post('/signup', async (c) => {
  const input = await readCredentials(c);
  if (!input) return fail(c, 400, 'bad-input');
  if (!USERNAME.test(input.username)) return fail(c, 400, 'bad-username');
  if ([...input.password].length < MIN_PASSWORD_LENGTH) return fail(c, 400, 'short-password');
  if (!(await signupOpen(c.env.DB))) return fail(c, 403, 'signup-closed');

  const id = crypto.randomUUID();
  const session = await startSession(c.env.DB, id);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO accounts (id, username, login_hash, created_at) VALUES (?, ?, ?, ?)').bind(
      id,
      input.username,
      hashPassword(input.password),
      Date.now(),
    ),
    session.insert,
  ]);
  setSessionCookie(c, session.token);
  return c.json({ username: input.username }, 201);
});

app.post('/login', async (c) => {
  const input = await readCredentials(c);
  if (!input) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  const now = Date.now();
  const account = await db
    .prepare('SELECT id, username, login_hash, locked_until FROM accounts WHERE username = ?')
    .bind(input.username)
    .first<Account & { login_hash: string; locked_until: number | null }>();
  if (!account) return fail(c, 401, 'wrong-login');
  if (account.locked_until !== null && account.locked_until > now) {
    return fail(c, 429, 'too-many-attempts', { retryAfter: Math.ceil((account.locked_until - now) / 1000) });
  }

  if (!verifyPassword(input.password, account.login_hash)) {
    // Incremented in SQL, not read-modify-write, so parallel guesses cannot keep resetting the count.
    const { failed_logins } = (await db
      .prepare('UPDATE accounts SET failed_logins = failed_logins + 1 WHERE id = ? RETURNING failed_logins')
      .bind(account.id)
      .first<{ failed_logins: number }>())!;
    if (failed_logins >= FREE_FAILURES) {
      const minutes = Math.min(2 ** (failed_logins - FREE_FAILURES), MAX_LOCK_MINUTES);
      await db.prepare('UPDATE accounts SET locked_until = ? WHERE id = ?').bind(now + minutes * 60_000, account.id).run();
    }
    return fail(c, 401, 'wrong-login');
  }

  const session = await startSession(db, account.id);
  await db.batch([
    db.prepare('UPDATE accounts SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(account.id),
    session.insert,
  ]);
  setSessionCookie(c, session.token);
  return c.json({ username: account.username });
});

app.post('/logout', async (c) => {
  const token = getCookie(c, 'session', 'host');
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, 'session', { prefix: 'host' });
  return c.body(null, 204);
});

app.get('/session', requireSession, (c) => c.json({ username: c.get('account').username }));

app.post('/relay', requireSession, (c) => relay(c.req.raw));

app.notFound((c) => fail(c, 404, 'not-found'));

export default app;

// Signup closes after the first account. Invites wait until a second user actually joins (tech-spec §1).
async function signupOpen(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT 1 FROM accounts LIMIT 1').first()) === null;
}

async function readCredentials(c: Context): Promise<{ username: string; password: string } | null> {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== 'object' || body === null) return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  return { username: username.normalize('NFC').toLowerCase(), password };
}

async function startSession(db: D1Database, accountId: string) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const insert = db
    .prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), accountId, Date.now() + SESSION_LIFETIME_MS);
  return { token, insert };
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

function setSessionCookie(c: Context, token: string) {
  // The database expiry is the real limit. The cookie only has to outlive it, and 400 days is the browser cap.
  setCookie(c, 'session', token, {
    prefix: 'host',
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: 400 * 24 * 60 * 60,
  });
}

async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fail(c: Context, status: ContentfulStatusCode, error: string, detail: Record<string, unknown> = {}) {
  return c.json({ error, ...detail }, status);
}
