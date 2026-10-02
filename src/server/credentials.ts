import type { Context } from 'hono';
import { fail, sha256Hex, type AppEnv } from './http';

export type Method = 'password' | 'recovery';
export type StoredAccount = { id: string; username: string; login_hash: string; recovery_hash: string; locked_until: number | null; suspended_at: number | null };

// 256 bits in base64: what the client derives from the password or the recovery key.
const PROOF = /^[A-Za-z0-9+/]{43}=$/;
const FREE_FAILURES = 5;
const MAX_LOCK_MINUTES = 60;

export function readProof(value: unknown): string | null {
  return typeof value === 'string' && PROOF.test(value) ? value : null;
}

export function readMethod(value: unknown): Method | null {
  return value === 'password' || value === 'recovery' ? value : null;
}

// A plain hash is enough: guessing a password from a stolen hash still costs the client's Argon2id per guess.
export const hashProof = sha256Hex;

export function findAccount(db: D1Database, column: 'id' | 'username', value: string) {
  return db
    .prepare(
      `SELECT a.id, a.username, a.login_hash, v.recovery_hash, a.locked_until, a.suspended_at FROM accounts a JOIN vaults v ON v.account_id = a.id WHERE a.${column} = ?`,
    )
    .bind(value)
    .first<StoredAccount>();
}

// The failed-login lock covers both methods and the password change. Returns the refusal, or null.
export async function checkProof(c: Context<AppEnv>, account: StoredAccount, method: Method, proof: string): Promise<Response | null> {
  const db = c.env.DB;
  const now = Date.now();
  if (account.locked_until !== null && account.locked_until > now) {
    return fail(c, 429, 'too-many-attempts', { retryAfter: Math.ceil((account.locked_until - now) / 1000) });
  }
  if (sameText(await hashProof(proof), method === 'password' ? account.login_hash : account.recovery_hash)) return null;

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

export function clearFailures(db: D1Database, accountId: string) {
  return db.prepare('UPDATE accounts SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(accountId);
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
