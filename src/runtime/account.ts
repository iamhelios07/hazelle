import { passwordCredential, recoveryCredential, type Credential, type Method, type VaultRecord } from '../vault/keys';
import { api, type Heard } from './api';
import { page } from './pages';

// What the account holds and the caps that apply to it, null for none. bytes is null while the account is restored or
// its store does not answer. fileBytes: the files it was first to store, which deleting pictures does not lower
// (server/files).
export type Storage = { bytes: number | null; bytesCap: number | null; fileBytes: number; fileBytesCap: number | null };
// What the server says about the signed-in account, on GET /session, signup and login alike. state: restoring while the
// operator restores it, at the account's own request. unreadNotices: what the operator sent that the person has not seen.
export type SessionFacts = { accountId: string; username: string; admin: boolean; suspended: boolean; state: 'active' | 'restoring'; storage: Storage; unreadNotices: number };
export type SignedIn = { session: SessionFacts; vault: VaultRecord };
export type Boot = { session: null; signupOpen: boolean } | SignedIn;
export type Signup = { accountId: string; username: string; passwordProof: string; passwordWrap: string; recoveryProof: string; recoveryWrap: string };

// null: a recovery key that is not one, so nothing was sent.
export const credentialFor = (username: string, method: Method, secret: string): Promise<Credential | null> =>
  method === 'password' ? passwordCredential(username, secret) : recoveryCredential(secret);

// The key the secret yields never leaves the page: only its proof is sent.
type Proof = Pick<Credential, 'method' | 'proof'>;
const proven = ({ method, proof }: Proof) => ({ method, proof });

// full: a write was refused for room and the account has not shrunk since, which another write or sync shows.
// restoring: the server refused this account's objects while the operator restores it, and no store has answered since.
export type Standing = { suspended: boolean; full: boolean; restoring: boolean; storage: Storage };

// The open account as the server last described it: the session answer, then whatever later answers say (runtime/api).
// A cap the operator changes is learned on the next page load.
export class AccountFacts {
  private now: Standing;
  private readonly listeners = new Set<() => void>();

  constructor({ suspended, state, storage }: SessionFacts) {
    this.now = { suspended, full: false, restoring: state === 'restoring', storage };
  }

  readonly snapshot = (): Standing => this.now;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

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
    }
  };

  private set(next: Standing) {
    this.now = next;
    for (const listener of this.listeners) listener();
  }
}

export const loadSession = () => api<Boot>('GET', 'session');
export const signUp = (signup: Signup) => api<SessionFacts>('POST', 'signup', signup);
export const logIn = (username: string, credential: Proof) => api<SignedIn>('POST', 'login', { username, ...proven(credential) });
export const logOut = () => api<undefined>('POST', 'logout');
export const changePassword = (current: Proof, next: { passwordProof: string; passwordWrap: string }) =>
  api<undefined>('PUT', 'vault/password', { ...proven(current), ...next });

// 탈퇴: asks the password or the recovery key again, as login does.
export const deleteAccount = (credential: Proof) => api<undefined>('DELETE', 'account', proven(credential));

// Plaintext to the operator, which a suspended account may send too. The server's MAX_REPORT_LENGTH (server/admin).
export const REPORT_LENGTH = 4000;
export const sendReport = (text: string) => api<undefined>('POST', 'reports', { text });

// What the operator sent this account, or every account there when it was sent. reportId: the report it answers.
export type Notice = { id: number; reportId: number | null; text: string; createdAt: number };
export const readNotices = (before: number | null) => page<'notices', Notice>('notices', 'notices', before);
// newest: the newest notice shown, so one sent since stays unread.
export const markNoticesSeen = (newest: number) => api<undefined>('POST', 'notices/seen', { id: newest });
