import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import type { RestoreAction } from '../contracts/admin';
import { CAP } from './caps';
import { checkProof, findAccount, hashProof, outsideVisitor, readMethod, readProof } from './credentials';
import { UNREAD_NOTICES } from './admin';
import { fail, ID, readObject, type Account, type AppEnv } from './http';
import { answerAction, answerBegin, leaveAccount, refuseLeft, restoreFrom, restorePoints, restoresOf, store } from './lifecycle';
import { canWrite, currentAccount, dropSessionCookie, endOtherSessions, endSession, requireOwnSession, requireSession, setSessionCookie, startSession } from './session';
import { insertVault, readVault, readWrap } from './vaults';

const USERNAME = /^[\p{L}\p{N}_.-]{2,32}$/u;
const ROOM = '(SELECT COUNT(*) FROM accounts) < (SELECT signup_cap FROM service)';

export const accounts = new Hono<AppEnv>();

// Signup creates the account, its vault and a session in one batch, so an account never exists without a vault, and
// claims the installation when no account has: the first signup is the operator. The client sends it only after the
// recovery key is saved. The account's file is prepared before the batch: a crash between leaves a file with no row,
// which the hourly reconciliation removes, never a row with no file.
accounts.post('/signup', async (c) => {
  const visitor = outsideVisitor(c);
  if (visitor && !c.env.limits.visitors.signups.limit(visitor).success) return fail(c, 429, 'too-many-signups');
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
  const db = c.env.db;

  const incarnation = randomBytes(16).toString('hex');
  const timeline = randomBytes(16).toString('hex');
  const [session, loginHash, recoveryHash] = await Promise.all([startSession(db, accountId, true), hashProof(passwordProof), hashProof(recoveryProof)]);
  const now = Date.now();
  // The insert itself checks the cap and the username, so two signups at once cannot both take the last place or the
  // same name: no read outside this batch decides. changes() carries its outcome to the vault, the session and the claim.
  // A backup hold covers the file and the batch, so a generation holds both or neither (backup/backups.ts).
  const [created, , , claim, room] = await c.env.backups.hold(async () => {
    await c.env.stores.prepare(incarnation, timeline);
    return db.batch<{ incarnation?: string; open?: number }>([
      db
        .prepare(
          `INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) SELECT ?1, ?2, ?3, ?4, ?5, ?6
           WHERE ${ROOM} AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = ?1 OR username = ?2) RETURNING incarnation`,
        )
        .bind(accountId, username, loginHash, now, incarnation, timeline),
      insertVault(db, accountId, { passwordWrap, recoveryWrap, recoveryHash }, now),
      session.insert,
      db.prepare('UPDATE installation SET operator_account = ? WHERE id = 1 AND operator_account IS NULL AND changes() = 1').bind(accountId),
      db.prepare(`SELECT ${ROOM} AS open`),
    ]);
  });
  if (!created!.results.length) return room!.results[0]!.open ? fail(c, 409, 'username-taken') : fail(c, 403, 'signup-closed');
  setSessionCookie(c, session.token);
  return c.json(await describe(c, { id: accountId, username, suspended: false, incarnation, state: 'active', admin: claim!.meta.changes === 1 }), 201);
});

// Answers like GET /session, so the client opens the vault without another request.
accounts.post('/login', async (c) => {
  const visitor = outsideVisitor(c);
  if (visitor) {
    const { success, retryAfter } = c.env.limits.visitors.logins.limit(visitor);
    if (!success) return fail(c, 429, 'too-many-attempts', { retryAfter });
  }
  const body = await readObject(c);
  const method = readMethod(body?.method);
  const proof = readProof(body?.proof);
  if (typeof body?.username !== 'string' || !USERNAME.test(body.username) || !method || !proof) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const account = await findAccount(db, 'username', body.username);
  const wrong = await checkProof(c, body.username, account, method, proof);
  if (wrong) return wrong;
  if (!account) return fail(c, 401, 'wrong-login');
  if (account.state === 'leaving') return fail(c, 403, 'account-leaving');

  const started = await startSession(db, account.id);
  await started.insert.run();
  setSessionCookie(c, started.token);
  const [session, vault] = await Promise.all([describe(c, { ...account, suspended: account.suspended_at !== null, admin: account.admin === 1 }), readVault(db, account.id)]);
  return c.json({ session, vault });
});

accounts.post('/logout', async (c) => {
  await endSession(c);
  return c.body(null, 204);
});

// No proof asked: a stolen session can only make the owner sign in again, and a new password ends it (vaults.ts).
accounts.post('/logout/others', requireSession, async (c) => {
  const { meta } = await endOtherSessions(c).run();
  return c.json({ ended: meta.changes });
});

// Everything a page load needs, in one request: from Korea each round trip can take seconds.
// signupOpen only tells the first screen which form to show. The signup insert decides.
accounts.get('/session', async (c) => {
  const account = await currentAccount(c);
  if (!account) return c.json({ session: null, signupOpen: Boolean(await c.env.db.prepare(`SELECT ${ROOM} AS open`).first('open')) });
  // For 헤이젤 지금's page-load mark (worker.ts), which counts the signed-in account.
  c.set('account', account);
  const [session, vault] = await Promise.all([describe(c, account), readVault(c.env.db, account.id)]);
  return c.json({ session, vault });
});

// 탈퇴. The proof is asked again, as for a new password, so a stolen session alone cannot delete the account. An
// account whose deletion was cut off is still admitted, to finish it. The reports it sent and the operator's log rows
// about it stay. The only operator cannot leave: the installation would have no one to run it.
accounts.delete('/account', requireOwnSession, async (c) => {
  const body = await readObject(c);
  const method = readMethod(body?.method);
  const proof = readProof(body?.proof);
  if (!method || !proof) return fail(c, 400, 'bad-input');
  const { id, incarnation } = c.get('account');
  const wrong = await checkProof(c, c.get('account').username, await findAccount(c.env.db, 'id', id), method, proof);
  if (wrong) return wrong;
  const left = await leaveAccount(c.env, c.executionCtx, id, incarnation, false);
  if (left !== 'left') return refuseLeft(c, left);
  dropSessionCookie(c);
  return c.body(null, 204);
});

// The account rewinds itself (lifecycle.ts). No proof is asked again, unlike 탈퇴: an undo gives the state back for
// RETENTION_MS. A suspended account adds nothing, so it begins none; one it began before may still be finished.
accounts.post('/account/restores', requireSession, canWrite, async (c) => {
  const from = restoreFrom(await readObject(c));
  if (!from) return fail(c, 400, 'bad-input');
  return answerBegin(c, c.get('account').id, null, from);
});

accounts.get('/account/points', requireSession, async (c) => c.json({ points: (await restorePoints(c.env.db, c.get('account').id))! }));

accounts.get('/account/restores', requireSession, async (c) => c.json({ restores: await restoresOf(c.env.db, c.get('account').id) }));

// Only the account's own restores, whoever began them: one the operator began is the account's too.
accounts.post('/account/restores/:id/:action{resume|finalize|cancel}', requireSession, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return fail(c, 400, 'bad-input');
  const own = await c.env.db.prepare('SELECT 1 FROM restores WHERE id = ? AND incarnation = ?').bind(id, c.get('account').incarnation).first();
  if (!own) return fail(c, 404, 'not-found');
  return answerAction(c, id, c.req.param('action') as RestoreAction);
});

// The client needs the account id: it is part of the AAD that binds the vault's wrapped keys to the account. storage:
// what the account holds and the caps that apply to it, null for none. bytes: null while the store does not answer,
// restoring among the reasons.
async function describe(c: Context<AppEnv>, account: Pick<Account, 'id' | 'username' | 'suspended' | 'incarnation' | 'state' | 'admin'>) {
  const { incarnation } = account;
  const [usage, facts] = await Promise.all([
    store(c.env, incarnation).usage(incarnation),
    c.env.db.prepare(
      `SELECT ${CAP.bytes} AS bytesCap, file_bytes AS fileBytes, ${CAP.fileBytes} AS fileBytesCap,
         ${UNREAD_NOTICES} AS unreadNotices
       FROM accounts WHERE incarnation = ?`,
    )
      .bind(incarnation)
      .first<{ bytesCap: number | null; fileBytes: number; fileBytesCap: number | null; unreadNotices: number }>(),
  ]);
  const { unreadNotices, ...storage } = facts!;
  return {
    accountId: account.id,
    username: account.username,
    admin: account.admin,
    suspended: account.suspended,
    state: account.state,
    incarnation,
    storage: { bytes: 'bytes' in usage ? usage.bytes : null, ...storage },
    unreadNotices,
    localProviders: [...c.env.localProviders],
  };
}
