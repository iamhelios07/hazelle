import { useEffect, useState, type ReactNode } from 'react';
import { api, holdAccount } from '../../runtime/api';
import { forgetVault } from '../../runtime/device-cache';
import { lockVault, recallVault, rememberVault } from '../../vault/device';
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
} from '../../vault/keys';
import { describeFailure, wrongSecret } from '../common/failure';
import type { Account } from '../session';
import { PasswordScreen } from './PasswordScreen';
import { RecoveryKeyScreen } from './RecoveryKeyScreen';
import { SignInScreen } from './SignInScreen';
import { UnreachableScreen } from './UnreachableScreen';

type LoginSession = { accountId: string; username: string };
type SignedIn = { session: LoginSession; vault: VaultRecord };
type Boot = { session: null; signupOpen: boolean } | SignedIn;
// Kept in memory until the recovery key is saved. Going back keeps the vault key and the recovery
// key, so a file already downloaded stays valid.
type Draft = { session: LoginSession } & Awaited<ReturnType<typeof createVault>>;

type State =
  | { kind: 'loading' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'signup'; step: 'password' | 'recovery'; draft: Draft | null }
  | { kind: 'login' }
  | { kind: 'locked'; signedIn: SignedIn }
  | { kind: 'recovered'; session: LoginSession; vaultKey: VaultKey; current: Credential }
  | { kind: 'unlocked'; session: LoginSession; vaultKey: VaultKey };

export type Unlocked = Account & { accountId: string; username: string; vaultKey: VaultKey };

async function loadState(): Promise<State> {
  const result = await api<Boot>('GET', 'session');
  if (!result.ok) return { kind: 'unreachable', message: describeFailure(result) };
  const boot = result.data;
  if (boot.session === null) return boot.signupOpen ? { kind: 'signup', step: 'password', draft: null } : { kind: 'login' };
  const vaultKey = await recallVault(boot.session.accountId);
  if (vaultKey) return { kind: 'unlocked', session: boot.session, vaultKey };
  return { kind: 'locked', signedIn: boot };
}

const vaultCredential = (username: string, method: Method, secret: string) =>
  method === 'password' ? passwordCredential(username, secret) : recoveryCredential(secret);

// Up to an open vault: loading → signed out → vault setup → locked → unlocked. children renders what is
// behind it, so account/ never imports the shell.
export function AccountFlow({ children }: { children: (unlocked: Unlocked) => ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  // The page holds the account it has open, and goes on holding it while it asks who it is now (loading,
  // unreachable): a request still leaving for that account stays refused. Once the server says the cookie names
  // another account, the page asks again and shows that one, which closes what was open.
  function show(next: State) {
    if (next.kind === 'unlocked') holdAccount(next.session.accountId, reload);
    else if (next.kind !== 'loading' && next.kind !== 'unreachable') holdAccount(null);
    setState(next);
  }

  function reload() {
    show({ kind: 'loading' });
    void loadState().then(show);
  }

  useEffect(() => {
    void loadState().then(show);
  }, []);

  async function unlocked(session: LoginSession, vaultKey: VaultKey) {
    await rememberVault(session.accountId, vaultKey);
    show({ kind: 'unlocked', session, vaultKey });
  }

  // A recovery key opens the vault but then asks for a new password, since the old one is lost.
  async function open(signedIn: SignedIn, credential: Credential): Promise<string | null> {
    const vaultKey = await openVault(signedIn.session.accountId, signedIn.vault, credential);
    if (!vaultKey) return wrongSecret(credential.method, false);
    if (credential.method === 'recovery') show({ kind: 'recovered', session: signedIn.session, vaultKey, current: credential });
    else await unlocked(signedIn.session, vaultKey);
    return null;
  }

  async function logout(accountId: string): Promise<string | null> {
    const result = await api('POST', 'logout');
    if (!result.ok) return describeFailure(result);
    await forgetVault(accountId);
    show({ kind: 'login' });
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
            onBack={() => show({ kind: 'signup', step: 'password', draft })}
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
            show({ kind: 'signup', step: 'recovery', draft: { ...vault, session: { accountId, username } } });
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
            const credential = await vaultCredential(username, method, secret);
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
            const credential = await vaultCredential(username, method, secret);
            return credential ? open(signedIn, credential) : wrongSecret(method, false);
          }}
          onLogout={() => void logout(signedIn.session.accountId).then((failure) => failure && show({ kind: 'unreachable', message: failure }))}
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
      return children({
        accountId: state.session.accountId,
        username: state.session.username,
        vaultKey: state.vaultKey,
        onLock: () => void lockVault().then(reload),
        onLogout: () => logout(state.session.accountId),
      });
  }
}
