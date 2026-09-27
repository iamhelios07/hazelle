import { Hono, type Context } from 'hono';
import { fail, readObject, type Account, type AppEnv } from './http';
import { hashPassword, verifyPassword } from './password';
import { currentAccount, endSession, setSessionCookie, startSession } from './session';
import { readVault } from './vaults';

const USERNAME = /^[\p{L}\p{N}_.-]{2,32}$/u;
const MIN_PASSWORD_LENGTH = 8;
const FREE_FAILURES = 5;
const MAX_LOCK_MINUTES = 60;

export const accounts = new Hono<AppEnv>();

accounts.post('/signup', async (c) => {
  const input = await readCredentials(c);
  if (!input) return fail(c, 400, 'bad-input');
  if (!USERNAME.test(input.username)) return fail(c, 400, 'bad-username');
  if ([...input.password].length < MIN_PASSWORD_LENGTH) return fail(c, 400, 'short-password');
  if (!(await signupOpen(c.env.DB))) return fail(c, 403, 'signup-closed');

  const account = { id: crypto.randomUUID(), username: input.username };
  const session = await startSession(c.env.DB, account.id);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO accounts (id, username, login_hash, created_at) VALUES (?, ?, ?, ?)').bind(
      account.id,
      account.username,
      hashPassword(input.password),
      Date.now(),
    ),
    session.insert,
  ]);
  setSessionCookie(c, session.token);
  return c.json(describe(account), 201);
});

accounts.post('/login', async (c) => {
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
  return c.json(describe(account));
});

accounts.post('/logout', async (c) => {
  await endSession(c);
  return c.body(null, 204);
});

// Everything a page load needs, in one request: from Korea each round trip can take seconds (tech-spec §1).
accounts.get('/session', async (c) => {
  const account = await currentAccount(c);
  if (!account) return c.json({ session: null, signupOpen: await signupOpen(c.env.DB) });
  return c.json({ session: describe(account), vault: await readVault(c.env.DB, account.id) });
});

// The client needs the account id: it is part of the AAD that binds the vault's wrapped keys to the account.
function describe(account: Account) {
  return { accountId: account.id, username: account.username };
}

// Signup closes after the first account. Invites wait until a second user actually joins (tech-spec §1).
async function signupOpen(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT 1 FROM accounts LIMIT 1').first()) === null;
}

async function readCredentials(c: Context): Promise<{ username: string; password: string } | null> {
  const body = await readObject(c);
  if (typeof body?.username !== 'string' || typeof body.password !== 'string') return null;
  return { username: body.username.normalize('NFC').toLowerCase(), password: body.password };
}
