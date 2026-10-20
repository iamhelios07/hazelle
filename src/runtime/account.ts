import { ChangeSignal } from '../change-signal';
import { MAX_DIAGNOSTICS_LENGTH, type AccountState } from '../contracts/admin';
import { passwordCredential, recoveryCredential, type Credential, type Method, type VaultRecord } from '../vault/keys';
import { api, SLOW_ROUTE_WAIT, type Heard } from './api';
import { page } from './pages';

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
export const signUp = (signup: Signup) => api<SessionFacts>('POST', 'signup', signup);
export const logIn = (username: string, credential: Proof) => api<SignedIn>('POST', 'login', { username, ...proven(credential) });
export const logOut = () => api<undefined>('POST', 'logout');
export const logOutOthers = () => api<{ ended: number }>('POST', 'logout/others');
export const changePassword = (current: Proof, next: { passwordProof: string; passwordWrap: string }) =>
  api<undefined>('PUT', 'vault/password', { ...proven(current), ...next });

export const deleteAccount = (credential: Proof) => api<undefined>('DELETE', 'account', proven(credential), undefined, SLOW_ROUTE_WAIT);

// diagnostics: the 문제 진단 the sender chose to send along, or null.
export const sendReport = (text: string, diagnostics: string | null) =>
  api<undefined>('POST', 'reports', { text, diagnostics: diagnostics?.slice(0, MAX_DIAGNOSTICS_LENGTH) ?? null });

// question: what a reply (reportId set) answers, null once that report was forgotten, a year after it was resolved.
export type Notice = { id: number; reportId: number | null; text: string; createdAt: number; question: string | null };
export const readNotices = (after: string | null, ask: { limit?: number } = {}) => page<'notices', Notice>('notices', 'notices', after, ask);
// What this account sent the operator, newest first. reply: the operator's answer, null for none (yet).
export type SentReport = { id: number; text: string; createdAt: number; resolvedAt: number | null; reply: string | null };
export const readSentReports = (after: string | null, ask: { limit?: number } = {}) => page<'reports', SentReport>('reports', 'reports', after, ask);
// newest: the newest notice shown, so one sent since stays unread.
export const markNoticesSeen = (newest: number) => api<undefined>('POST', 'notices/seen', { id: newest });
