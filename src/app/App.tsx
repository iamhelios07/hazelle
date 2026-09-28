import { useCallback, useEffect, useState } from 'react';
import { api } from '../runtime/api';
import { forgetVault, recallVault, rememberVault } from '../vault/device';
import {
  canonicalUsername,
  createVault,
  openVault,
  passwordCredential,
  recoveryCredential,
  wrapWithPassword,
  type Credential,
  type Method,
  type VaultKey,
  type VaultRecord,
} from '../vault/keys';
import { describeFailure, wrongSecret } from './screens/failure';
import { PasswordScreen } from './screens/PasswordScreen';
import { RecoveryKeyScreen } from './screens/RecoveryKeyScreen';
import { SignInScreen } from './screens/SignInScreen';
import { UnreachableScreen } from './screens/UnreachableScreen';
import { Workspace } from './Workspace';

type Session = { accountId: string; username: string };
type SignedIn = { session: Session; vault: VaultRecord };
type Boot = { session: null; signupOpen: boolean } | SignedIn;
// Kept in memory until the recovery key is saved. Going back keeps the vault key and the recovery
// key, so a file already downloaded stays valid.
type Draft = { session: Session } & Awaited<ReturnType<typeof createVault>>;

type State =
  | { kind: 'loading' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'signup'; step: 'password' | 'recovery'; draft: Draft | null }
  | { kind: 'login' }
  | { kind: 'locked'; signedIn: SignedIn }
  | { kind: 'recovered'; session: Session; vaultKey: VaultKey; current: Credential }
  | { kind: 'unlocked'; session: Session; vaultKey: VaultKey; message: string | null };

async function loadState(): Promise<State> {
  const result = await api<Boot>('GET', 'session');
  if (!result.ok) return { kind: 'unreachable', message: describeFailure(result) };
  const boot = result.data;
  if (boot.session === null) return boot.signupOpen ? { kind: 'signup', step: 'password', draft: null } : { kind: 'login' };
  const vaultKey = await recallVault(boot.session.accountId);
  if (vaultKey) return { kind: 'unlocked', session: boot.session, vaultKey, message: null };
  return { kind: 'locked', signedIn: boot };
}

const credentialFor = (username: string, method: Method, secret: string) =>
  method === 'password' ? passwordCredential(username, secret) : recoveryCredential(secret);

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    void loadState().then(setState);
  }, []);

  useEffect(() => {
    void loadState().then(setState);
  }, []);

  async function unlocked(session: Session, vaultKey: VaultKey) {
    await rememberVault(session.accountId, vaultKey);
    setState({ kind: 'unlocked', session, vaultKey, message: null });
  }

  // A recovery key opens the vault but then asks for a new password, since the old one is lost.
  async function open(signedIn: SignedIn, credential: Credential): Promise<string | null> {
    const vaultKey = await openVault(signedIn.session.accountId, signedIn.vault, credential);
    if (!vaultKey) return wrongSecret(credential.method, false);
    if (credential.method === 'recovery') setState({ kind: 'recovered', session: signedIn.session, vaultKey, current: credential });
    else await unlocked(signedIn.session, vaultKey);
    return null;
  }

  async function logout(): Promise<string | null> {
    const result = await api('POST', 'logout');
    if (!result.ok) return describeFailure(result);
    await forgetVault();
    setState({ kind: 'login' });
    return null;
  }

  switch (state.kind) {
    case 'loading':
      return null;
    case 'unreachable':
      return <UnreachableScreen message={state.message} onRetry={reload} />;
    case 'signup': {
      const { draft } = state;
      if (state.step === 'recovery' && draft) {
        return (
          <RecoveryKeyScreen
            username={draft.session.username}
            recoveryKey={draft.recoveryKey}
            onBack={() => setState({ kind: 'signup', step: 'password', draft })}
            onStart={async () => {
              const result = await api('POST', 'signup', { ...draft.session, ...draft.signup });
              if (!result.ok) return describeFailure(result);
              await unlocked(draft.session, draft.vaultKey);
              return null;
            }}
          />
        );
      }
      return (
        <PasswordScreen
          mode="signup"
          username={draft?.session.username ?? ''}
          onDone={async (typed, password) => {
            const username = canonicalUsername(typed);
            const credential = await passwordCredential(username, password);
            const accountId = draft?.session.accountId ?? crypto.randomUUID();
            const vault = draft
              ? { ...draft, signup: { ...draft.signup, ...(await wrapWithPassword(accountId, draft.vaultKey, credential)) } }
              : await createVault(accountId, credential);
            setState({ kind: 'signup', step: 'recovery', draft: { ...vault, session: { accountId, username } } });
            return null;
          }}
        />
      );
    }
    case 'login':
      return (
        <SignInScreen
          account={null}
          onSubmit={async (typed, method, secret) => {
            const username = canonicalUsername(typed);
            const credential = await credentialFor(username, method, secret);
            if (!credential) return wrongSecret(method, true);
            const result = await api<SignedIn>('POST', 'login', { username, method, proof: credential.proof });
            if (!result.ok) return result.error === 'wrong-login' ? wrongSecret(method, true) : describeFailure(result);
            return open(result.data, credential);
          }}
        />
      );
    case 'locked': {
      const { signedIn } = state;
      return (
        <SignInScreen
          account={signedIn.session.username}
          onSubmit={async (username, method, secret) => {
            const credential = await credentialFor(username, method, secret);
            return credential ? open(signedIn, credential) : wrongSecret(method, false);
          }}
          onLogout={() => void logout().then((failure) => failure && setState({ kind: 'unreachable', message: failure }))}
        />
      );
    }
    case 'recovered': {
      const { session, vaultKey, current } = state;
      return (
        <PasswordScreen
          mode="reset"
          username={session.username}
          onDone={async (username, password) => {
            const next = await wrapWithPassword(session.accountId, vaultKey, await passwordCredential(username, password));
            const result = await api('PUT', 'vault/password', { method: current.method, proof: current.proof, ...next });
            if (!result.ok) return describeFailure(result);
            await unlocked(session, vaultKey);
            return null;
          }}
        />
      );
    }
    case 'unlocked':
      return (
        <Workspace
          accountId={state.session.accountId}
          vaultKey={state.vaultKey}
          message={state.message}
          onLock={() => void forgetVault().then(reload)}
          onLogout={() => void logout().then((failure) => failure && setState({ ...state, message: failure }))}
        />
      );
  }
}
