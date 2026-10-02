import { passwordCredential, recoveryCredential, type Credential, type Method, type VaultRecord } from '../vault/keys';
import { api } from './api';

// What the server says about the signed-in account, on GET /session, signup and login alike.
export type SessionFacts = { accountId: string; username: string; admin: boolean; suspended: boolean };
export type SignedIn = { session: SessionFacts; vault: VaultRecord };
export type Boot = { session: null; signupOpen: boolean } | SignedIn;
export type Signup = { accountId: string; username: string; passwordProof: string; passwordWrap: string; recoveryProof: string; recoveryWrap: string };

// null: a recovery key that is not one, so nothing was sent.
export const credentialFor = (username: string, method: Method, secret: string): Promise<Credential | null> =>
  method === 'password' ? passwordCredential(username, secret) : recoveryCredential(secret);

// The key the secret yields never leaves the page: only its proof is sent.
type Proof = Pick<Credential, 'method' | 'proof'>;
const proven = ({ method, proof }: Proof) => ({ method, proof });

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
