import { Hono, type Context } from 'hono';
import { CAP } from './caps';
import { checkProof, clearFailures, findAccount, hashProof, readMethod, readProof } from './credentials';
import { fail, ID, isAdmin, readObject, type Account, type AppEnv } from './http';
import { currentAccount, dropSessionCookie, endSession, requireSession, setSessionCookie, startSession } from './session';
import { insertVault, readVault, readWrap } from './vaults';

const USERNAME = /^[\p{L}\p{N}_.-]{2,32}$/u;
// Signup is open while there are fewer accounts than the operator's cap.
const ROOM = '(SELECT COUNT(*) FROM accounts) < (SELECT signup_cap FROM service)';

export const accounts = new Hono<AppEnv>();

// Signup creates the account, its vault and a session in one batch, so an account never exists
// without a vault. The client sends it only after the recovery key is saved.
accounts.post('/signup', async (c) => {
  const body = await readObject(c);
  const accountId = typeof body?.accountId === 'string' && ID.test(body.accountId) ? body.accountId : null;
  const passwordProof = readProof(body?.passwordProof);
  const recoveryProof = readProof(body?.recoveryProof);
  const passwordWrap = readWrap(body?.passwordWrap);
  const recoveryWrap = readWrap(body?.recoveryWrap);
  // The operator is named by an account id, and ids are the client's to make: should that account ever be gone,
  // nobody may sign up as it.
  if (!accountId || isAdmin(c, accountId) || typeof body?.username !== 'string' || !passwordProof || !recoveryProof || !passwordWrap || !recoveryWrap) {
    return fail(c, 400, 'bad-input');
  }
  // The password salt comes from the username as the client wrote it, so any other form is refused, not fixed.
  const username = body.username;
  if (!USERNAME.test(username) || username !== username.normalize('NFC').toLowerCase()) return fail(c, 400, 'bad-username');
  const db = c.env.DB;

  const [session, loginHash, recoveryHash] = await Promise.all([startSession(db, accountId, true), hashProof(passwordProof), hashProof(recoveryProof)]);
  const now = Date.now();
  // The insert itself checks the cap and the username, so two signups at once cannot both take the last place or the
  // same name: no read outside this batch decides. changes() carries its outcome to the vault and the session.
  const [created, , , room] = await db.batch<{ open?: number }>([
    db
      .prepare(`INSERT INTO accounts (id, username, login_hash, created_at) SELECT ?1, ?2, ?3, ?4 WHERE ${ROOM} AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = ?1 OR username = ?2) RETURNING id`)
      .bind(accountId, username, loginHash, now),
    insertVault(db, accountId, { passwordWrap, recoveryWrap, recoveryHash }, now),
    session.insert,
    db.prepare(`SELECT ${ROOM} AS open`),
  ]);
  if (!created!.results.length) return room!.results[0]!.open ? fail(c, 409, 'username-taken') : fail(c, 403, 'signup-closed');
  setSessionCookie(c, session.token);
  return c.json(await describe(c, { id: accountId, username, suspended: false }), 201);
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

  const started = await startSession(db, account.id);
  await db.batch([clearFailures(db, account.id), started.insert]);
  setSessionCookie(c, started.token);
  const [session, vault] = await Promise.all([describe(c, { ...account, suspended: account.suspended_at !== null }), readVault(db, account.id)]);
  return c.json({ session, vault });
});

accounts.post('/logout', async (c) => {
  await endSession(c);
  return c.body(null, 204);
});

// Everything a page load needs, in one request: from Korea each round trip can take seconds.
// signupOpen only tells the first screen which form to show. The signup insert decides.
accounts.get('/session', async (c) => {
  const account = await currentAccount(c);
  if (!account) return c.json({ session: null, signupOpen: Boolean(await c.env.DB.prepare(`SELECT ${ROOM} AS open`).first('open')) });
  const [session, vault] = await Promise.all([describe(c, account), readVault(c.env.DB, account.id)]);
  return c.json({ session, vault });
});

// 탈퇴. The proof is asked again, as for a new password, so a stolen session alone cannot delete the account. The
// delete cascades to its sessions, vault and objects. Its stored files stay: they are kept by content and may be
// another account's too (files.ts). The reports it sent and the operator's log rows about it stay as well.
accounts.delete('/account', requireSession, async (c) => {
  const body = await readObject(c);
  const method = readMethod(body?.method);
  const proof = readProof(body?.proof);
  if (!method || !proof) return fail(c, 400, 'bad-input');
  const db = c.env.DB;
  const id = c.get('account').id;
  const refused = await checkProof(c, (await findAccount(db, 'id', id))!, method, proof);
  if (refused) return refused;
  await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  dropSessionCookie(c);
  return c.body(null, 204);
});

// The client needs the account id: it is part of the AAD that binds the vault's wrapped keys to the account. storage:
// what the account holds and the caps that apply to it, null for none.
async function describe(c: Context<AppEnv>, account: Account) {
  const storage = await c.env.DB.prepare(`SELECT bytes, ${CAP.bytes} AS bytesCap, file_bytes AS fileBytes, ${CAP.fileBytes} AS fileBytesCap FROM accounts WHERE id = ?`)
    .bind(account.id)
    .first<{ bytes: number; bytesCap: number | null; fileBytes: number; fileBytesCap: number | null }>();
  return { accountId: account.id, username: account.username, admin: isAdmin(c, account.id), suspended: account.suspended, storage: storage! };
}
