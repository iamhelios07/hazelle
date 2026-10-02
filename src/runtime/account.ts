import { passwordCredential, recoveryCredential, type Credential, type Method, type VaultRecord } from '../vault/keys';
import { api, type Heard } from './api';

// What the account holds and the caps that apply to it, null for none. fileBytes: the files it was first to store,
// which deleting pictures does not lower (server/files).
export type Storage = { bytes: number; bytesCap: number | null; fileBytes: number; fileBytesCap: number | null };
// What the server says about the signed-in account, on GET /session, signup and login alike.
export type SessionFacts = { accountId: string; username: string; admin: boolean; suspended: boolean; storage: Storage };
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
export type Standing = { suspended: boolean; full: boolean; storage: Storage };

// The open account as the server last described it: the session answer, then whatever later answers say (runtime/api).
// A cap the operator changes is learned on the next page load.
export class AccountFacts {
  private now: Standing;
  private readonly listeners = new Set<() => void>();

  constructor({ suspended, storage }: SessionFacts) {
    this.now = { suspended, full: false, storage };
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
      case 'bytes':
        return this.set({ ...now, full: now.full && heard.bytes >= now.storage.bytes, storage: { ...now.storage, bytes: heard.bytes } });
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
