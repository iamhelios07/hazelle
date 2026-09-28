import { Hono } from 'hono';
import { checkProof, clearFailures, findAccount, hashProof, readMethod, readProof } from './credentials';
import { fail, ID, readObject, type Account, type AppEnv } from './http';
import { currentAccount, endSession, setSessionCookie, startSession } from './session';
import { insertVault, readVault, readWrap } from './vaults';

const USERNAME = /^[\p{L}\p{N}_.-]{2,32}$/u;

export const accounts = new Hono<AppEnv>();

// Signup creates the account, its vault and a session in one batch, so an account never exists
// without a vault. The client sends it only after the recovery key is saved (design F1).
accounts.post('/signup', async (c) => {
  const body = await readObject(c);
  const accountId = typeof body?.accountId === 'string' && ID.test(body.accountId) ? body.accountId : null;
  const passwordProof = readProof(body?.passwordProof);
  const recoveryProof = readProof(body?.recoveryProof);
  const passwordWrap = readWrap(body?.passwordWrap);
  const recoveryWrap = readWrap(body?.recoveryWrap);
  if (!accountId || typeof body?.username !== 'string' || !passwordProof || !recoveryProof || !passwordWrap || !recoveryWrap) {
    return fail(c, 400, 'bad-input');
  }
  // The password salt comes from the username as the client wrote it, so any other form is refused, not fixed.
  const username = body.username;
  if (!USERNAME.test(username) || username !== username.normalize('NFC').toLowerCase()) return fail(c, 400, 'bad-username');
  const db = c.env.DB;
  if (!(await signupOpen(db))) return fail(c, 403, 'signup-closed');

  const account = { id: accountId, username };
  const session = await startSession(db, account.id);
  const now = Date.now();
  await db.batch([
    db
      .prepare('INSERT INTO accounts (id, username, login_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(account.id, account.username, await hashProof(passwordProof), now),
    insertVault(db, account.id, { passwordWrap, recoveryWrap, recoveryHash: await hashProof(recoveryProof) }, now),
    session.insert,
  ]);
  setSessionCookie(c, session.token);
  return c.json(describe(account), 201);
});

// Answers like GET /session, so the client opens the vault without another request.
accounts.post('/login', async (c) => {
  const body = await readObject(c);
  const method = readMethod(body?.method);
  const proof = readProof(body?.proof);
  if (typeof body?.username !== 'string' || !method || !proof) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  const account = await findAccount(db, 'username', body.username);
  if (!account) return fail(c, 401, 'wrong-login');
  const refused = await checkProof(c, account, method, proof);
  if (refused) return refused;

  const session = await startSession(db, account.id);
  await db.batch([clearFailures(db, account.id), session.insert]);
  setSessionCookie(c, session.token);
  return c.json({ session: describe(account), vault: await readVault(db, account.id) });
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
