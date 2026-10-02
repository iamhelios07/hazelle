import { useEffect, useState, type ReactNode } from 'react';
import { AccountFacts, changePassword, credentialFor, loadSession, logIn, logOut, signUp, type SessionFacts, type SignedIn } from '../../runtime/account';
import { holdAccount } from '../../runtime/api';
import { forgetVault } from '../../runtime/device-cache';
import { lockVault, recallVault, rememberVault } from '../../vault/device';
import { canonicalUsername, createVault, openVault, passwordCredential, wrapWithPassword, type Credential, type VaultKey } from '../../vault/keys';
import { describeFailure, wrongSecret } from '../common/failure';
import type { Account } from '../session';
import { PasswordScreen } from './PasswordScreen';
import { RecoveryKeyScreen } from './RecoveryKeyScreen';
import { SignInScreen } from './SignInScreen';
import { UnreachableScreen } from './UnreachableScreen';

// Kept in memory until the recovery key is saved. Going back keeps the vault key and the recovery
// key, so a file already downloaded stays valid.
type Draft = { session: { accountId: string; username: string } } & Awaited<ReturnType<typeof createVault>>;

type State =
  | { kind: 'loading' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'signup'; step: 'password' | 'recovery'; draft: Draft | null }
  // notice: why this shows instead of what was open.
  | { kind: 'login'; signupOpen: boolean; notice: string | null }
  | { kind: 'locked'; signedIn: SignedIn; notice: string | null }
  | { kind: 'recovered'; session: SessionFacts; vaultKey: VaultKey; current: Credential }
  | { kind: 'unlocked'; session: SessionFacts; vaultKey: VaultKey; facts: AccountFacts };

export type Unlocked = Account & { accountId: string; username: string; vaultKey: VaultKey };

const ELSEWHERE = '다른 탭에서 다른 계정으로 로그인해서 이 탭에 열려 있던 계정을 닫았어요.';

// Signed out, the page opens on signup while there is room, unless it came from leaving an account.
async function loadState(notice: string | null = null, prefer: 'signup' | 'login' = 'signup'): Promise<State> {
  const result = await loadSession();
  if (!result.ok) return { kind: 'unreachable', message: describeFailure(result) };
  const boot = result.data;
  if (boot.session === null) {
    return boot.signupOpen && prefer === 'signup' && notice === null ? { kind: 'signup', step: 'password', draft: null } : { kind: 'login', signupOpen: boot.signupOpen, notice };
  }
  const vaultKey = await recallVault(boot.session.accountId);
  if (vaultKey) return { kind: 'unlocked', session: boot.session, vaultKey, facts: new AccountFacts(boot.session) };
  return { kind: 'locked', signedIn: boot, notice };
}

// Up to an open vault: loading → signed out → vault setup → locked → unlocked. children renders what is
// behind it, so account/ never imports the shell.
export function AccountFlow({ children }: { children: (unlocked: Unlocked) => ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  // The page holds the account it is signed in as, locked or not, and goes on holding it while it asks who it is now
  // (loading, unreachable): a request still leaving for that account stays refused. Once the server says the cookie
  // names another account, the page asks again and shows that one, which closes what was open. Unlocked, what answers
  // say of the account goes to its facts.
  function show(next: State) {
    const facts = next.kind === 'unlocked' ? next.facts : null;
    if (next.kind === 'locked' || next.kind === 'recovered' || next.kind === 'unlocked') {
      const session = next.kind === 'locked' ? next.signedIn.session : next.session;
      holdAccount(session.accountId, (heard) => (heard.kind === 'elsewhere' ? reload(ELSEWHERE) : facts?.heard(heard)));
    } else if (next.kind !== 'loading' && next.kind !== 'unreachable') holdAccount(null);
    setState(next);
  }

  function reload(notice: string | null = null, prefer: 'signup' | 'login' = 'signup') {
    show({ kind: 'loading' });
    void loadState(notice, prefer).then(show);
  }

  useEffect(() => {
    void loadState().then(show);
  }, []);

  async function unlocked(session: SessionFacts, vaultKey: VaultKey) {
    await rememberVault(session.accountId, vaultKey);
    show({ kind: 'unlocked', session, vaultKey, facts: new AccountFacts(session) });
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
    const result = await logOut();
    if (!result.ok) return describeFailure(result);
    await forgetVault(accountId);
    reload(null, 'login');
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
              const result = await signUp({ ...draft.session, ...draft.signup });
              if (!result.ok) return describeFailure(result);
              await unlocked(result.data, draft.vaultKey);
              return null;
            }}
          />
        );
      }
      return (
        <PasswordScreen
          mode="signup"
          username={draft?.session.username ?? ''}
          onSignIn={() => show({ kind: 'login', signupOpen: true, notice: null })}
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
          notice={state.notice}
          signup={state.signupOpen ? () => show({ kind: 'signup', step: 'password', draft: null }) : 'full'}
          onSubmit={async (typed, method, secret) => {
            const username = canonicalUsername(typed);
            const credential = await credentialFor(username, method, secret);
            if (!credential) return wrongSecret(method, true);
            const result = await logIn(username, credential);
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
          notice={state.notice}
          onSubmit={async (username, method, secret) => {
            const credential = await credentialFor(username, method, secret);
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
            const result = await changePassword(current, next);
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
        admin: state.session.admin,
        facts: state.facts,
        vaultKey: state.vaultKey,
        onLock: () => void lockVault().then(() => reload()),
        onLogout: () => logout(state.session.accountId),
      });
  }
}
