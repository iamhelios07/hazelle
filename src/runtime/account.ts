import { ChangeSignal } from '../change-signal';
import type { AccountState } from '../contracts/admin';
import { createVault, openVault, passwordCredential, recoveryCredential, type Credential, type Method, type VaultKey, type VaultRecord } from '../vault/keys';
import { api, holdAccount, SLOW_ROUTE_WAIT, type ApiResult, type Heard } from './api';
import { page } from './pages';
import { guestSignupRecovery, recallGuest } from '../vault/device';
import { transferGuest, type GuestTransferOptions } from './guest-transfer';

// Caps are null for none. bytes is null while the account is restored or its store does not answer. fileBytes: the
// pictures stored for it, which deleting them in the app does not lower (server/files).
export type Storage = { bytes: number | null; bytesCap: number | null; fileBytes: number; fileBytesCap: number | null };
export type SessionFacts = { accountId: string; username: string; admin: boolean; suspended: boolean; state: Exclude<AccountState, 'leaving'>; storage: Storage; unreadNotices: number; unreadBoard: number; localProviders: readonly string[] };
export type SignedIn = { session: SessionFacts; vault: VaultRecord };
type Boot = { session: null; signupOpen: boolean } | SignedIn;
export type Signup = { accountId: string; username: string; passwordProof: string; passwordWrap: string; recoveryProof: string; recoveryWrap: string };

// null: a recovery key that is not one, so nothing was sent.
export const credentialFor = (username: string, method: Method, secret: string): Promise<Credential | null> =>
  method === 'password' ? passwordCredential(username, secret) : recoveryCredential(secret);

// The key the secret yields never leaves the page: only its proof is sent.
type Proof = Pick<Credential, 'method' | 'proof'>;
const proven = ({ method, proof }: Proof) => ({ method, proof });

// full: a write was refused for room and the account has not shrunk since, which another write or sync shows.
// restoring: the server refused this account's objects while the operator restores it, and no store has answered since.
// unreadNotices, unreadBoard: as the session, then each sync, last said.
export type Standing = { suspended: boolean; full: boolean; restoring: boolean; storage: Storage; unreadNotices: number; unreadBoard: number };

// A cap the operator changes is learned on the next page load.
export class AccountFacts {
  private now: Standing;
  private readonly changes = new ChangeSignal();

  constructor({ suspended, state, storage, unreadNotices, unreadBoard }: SessionFacts) {
    this.now = { suspended, full: false, restoring: state === 'restoring', storage, unreadNotices, unreadBoard };
  }

  readonly snapshot = (): Standing => this.now;

  readonly subscribe = this.changes.subscribe;

  readonly heard = (heard: Exclude<Heard, { kind: 'elsewhere' }>) => {
    const { now } = this;
    switch (heard.kind) {
      case 'suspended':
        return this.set({ ...now, suspended: true });
      case 'storage-full':
        return this.set({ ...now, full: true });
      case 'restoring':
        return this.set({ ...now, restoring: true });
      // Only the account's store states its bytes, and it answers only once the restore is over.
      case 'bytes':
        return this.set({ ...now, restoring: false, full: now.full && now.storage.bytes !== null && heard.bytes >= now.storage.bytes, storage: { ...now.storage, bytes: heard.bytes } });
      case 'file-bytes':
        return this.set({ ...now, storage: { ...now.storage, fileBytes: heard.fileBytes } });
      case 'notices':
        return heard.unread === now.unreadNotices ? undefined : this.set({ ...now, unreadNotices: heard.unread });
      case 'board':
        return heard.unread === now.unreadBoard ? undefined : this.set({ ...now, unreadBoard: heard.unread });
    }
  };

  private set(next: Standing) {
    this.now = next;
    this.changes.notify();
  }
}

export const loadSession = () => api<Boot>('GET', 'session');
export const signUp = (signup: Signup, signal?: AbortSignal) => api<SessionFacts>('POST', 'signup', signup, signal);
export async function logIn(username: string, credential: Credential, options: GuestTransferOptions = {}): Promise<ApiResult<SignedIn>> {
  const signedIn = await api<SignedIn>('POST', 'login', { username, ...proven(credential) }, options.signal);
  if (!signedIn.ok) return signedIn;
  const guest = await recallGuest();
  if (guest?.accountId === signedIn.data.session.accountId) {
    const vaultKey = await openVault(guest.accountId, signedIn.data.vault, credential);
    if (!vaultKey || !sameVault(guest.vaultKey, vaultKey)) return { ok: false, error: 'unreadable' };
    const resumed = await resumeGuestSignup(signedIn.data, vaultKey, options);
    if (!resumed.ok) return resumed;
  }
  return signedIn;
}

export type GuestSignup = Awaited<ReturnType<typeof prepareGuestSignup>>;

// Like createVault, this prepares only: the recovery key must be downloaded before the screen calls signUpGuest.
export async function prepareGuestSignup(username: string, password: Credential) {
  const guest = await recallGuest();
  if (!guest) throw new Error('No guest vault');
  const vault = await createVault(guest.accountId, password, guest.vaultKey, await guestSignupRecovery(guest.accountId));
  return { ...vault, username, accountId: guest.accountId, password };
}

export async function signUpGuest(draft: GuestSignup, options: GuestTransferOptions = {}): Promise<ApiResult<SessionFacts>> {
  if (options.signal?.aborted) return { ok: false, error: 'stopped' };
  const signedUp = await signUp({ accountId: draft.accountId, username: draft.username, ...draft.signup }, options.signal);
  if (!signedUp.ok) {
    if (signedUp.error !== 'username-taken' && signedUp.error !== 'signup-closed') return signedUp;
    // Signup may have landed before its answer was lost. Authenticate its existing wraps; never replace them on retry.
    const signedIn = await logIn(draft.username, draft.password, options);
    if (!signedIn.ok) return signedIn.error === 'wrong-login' ? signedUp : signedIn;
    if (signedIn.data.session.accountId !== draft.accountId) return signedUp;
    const key = await openVault(draft.accountId, signedIn.data.vault, draft.password);
    return key && sameVault(key, draft.vaultKey) ? { ok: true, data: signedIn.data.session } : { ok: false, error: 'unreadable' };
  }
  holdAccount(draft.accountId);
  const uploaded = await transferGuest(draft.accountId, draft.vaultKey, options);
  return uploaded.ok ? signedUp : uploaded;
}

export function uploadGuest(accountId: string, vaultKey: VaultKey, options: GuestTransferOptions = {}): Promise<ApiResult<null>> {
  holdAccount(accountId);
  return transferGuest(accountId, vaultKey, options);
}

// Also usable after loadSession finds a signup whose page closed during upload, before opening an account session.
export async function resumeGuestSignup(signedIn: SignedIn, vaultKey: VaultKey, options: GuestTransferOptions = {}): Promise<ApiResult<null>> {
  const guest = await recallGuest();
  if (!guest || guest.accountId !== signedIn.session.accountId) return { ok: true, data: null };
  if (!sameVault(guest.vaultKey, vaultKey)) return { ok: false, error: 'unreadable' };
  holdAccount(signedIn.session.accountId);
  return transferGuest(signedIn.session.accountId, vaultKey, options);
}

const sameVault = (one: VaultKey, two: VaultKey) => one.length === two.length && one.every((byte, index) => byte === two[index]);

// Account access is independent of runtime/features' chat → character → prompt → settings inheritance.
export const ACCOUNT_CAPABILITIES = {
  fileBackup: { guest: true, account: true },
  boardReading: { guest: true, account: true },
  serverBackup: { guest: false, account: true },
  restorePoint: { guest: false, account: true },
  shareLink: { guest: false, account: true },
  otherDevices: { guest: false, account: true },
  detachedReply: { guest: false, account: true },
  boardWriting: { guest: false, account: true },
  operatorPost: { guest: false, account: true },
  lock: { guest: false, account: true },
  logout: { guest: false, account: true },
} as const;
export const logOut = () => api<undefined>('POST', 'logout');
export const logOutOthers = () => api<{ ended: number }>('POST', 'logout/others');
export const changePassword = (current: Proof, next: { passwordProof: string; passwordWrap: string }) =>
  api<undefined>('PUT', 'vault/password', { ...proven(current), ...next });

export const deleteAccount = (credential: Proof) => api<undefined>('DELETE', 'account', proven(credential), undefined, SLOW_ROUTE_WAIT);

export type Notice = { id: number; text: string; createdAt: number };
export const readNotices = (after: string | null, ask: { limit?: number } = {}) => page<'notices', Notice>('notices', 'notices', after, ask);
// newest: the newest notice shown, so one sent since stays unread.
export const markNoticesSeen = (newest: number) => api<undefined>('POST', 'notices/seen', { id: newest });
