import { useEffect, useState, type ReactNode } from 'react';
import { AccountFacts, changePassword, credentialFor, guestFacts, loadSession, logIn, logOut, prepareGuestSignup, signUpGuest, uploadGuest, type GuestSignup, type SessionFacts, type SignedIn } from '../../runtime/account';
import { holdAccount } from '../../runtime/api';
import { cachedAccounts, forgetVault } from '../../runtime/device-cache';
import { guestAccount } from '../../runtime/guest-store';
import { discardGuest, guestWithContent, type GuestTransferStep } from '../../runtime/guest-transfer';
import { lockVault, recallVault, rememberVault } from '../../vault/device';
import { DatabaseBlocked } from '../../vault/database';
import { canonicalUsername, openVault, passwordCredential, wrapWithPassword, type Credential, type VaultKey } from '../../vault/keys';
import { clearDownloads } from '../common/download';
import { describeFailure, wrongSecret } from '../common/failure';
import type { Account } from '../session';
import { Brand, Progress, Screen } from '../ui';
import { GuestDataScreen } from './GuestDataScreen';
import { MovingScreen, type Moved } from './MovingScreen';
import { PasswordScreen } from './PasswordScreen';
import { RecoveryKeyScreen } from './RecoveryKeyScreen';
import { SignInScreen } from './SignInScreen';
import { UnreachableScreen } from './UnreachableScreen';

type State =
  | { kind: 'loading' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'guest'; accountId: string; vaultKey: VaultKey; signupOpen: boolean; facts: AccountFacts }
  // draft: kept until the upload lands, so going back, or a failed upload, keeps the same recovery key.
  | { kind: 'signup'; step: 'password'; draft: GuestSignup | null }
  | { kind: 'signup'; step: 'recovery'; draft: GuestSignup; failure: string | null }
  | { kind: 'moving'; moved: Moved }
  | { kind: 'guest-data'; session: SessionFacts; vaultKey: VaultKey; failure: string | null }
  | { kind: 'login'; notice: string | null; username: string }
  | { kind: 'locked'; signedIn: SignedIn; notice: string | null }
  | { kind: 'recovered'; session: SessionFacts; vaultKey: VaultKey; current: Credential }
  | { kind: 'unlocked'; session: SessionFacts; vaultKey: VaultKey; facts: AccountFacts };

// landing: a session and its key in hand, which still waits on what this browser holds of a guest (land).
type Loaded = State | { kind: 'landing'; session: SessionFacts; vaultKey: VaultKey };

export type Unlocked = Account & { accountId: string; username: string; vaultKey: VaultKey };

const ELSEWHERE = '다른 탭에서 다른 계정으로 로그인해서 로그아웃됐어요.';
const GUEST_NAME = '손님';

// Who this browser opens as with no session: the username of the account it last opened, so a lapsed session asks for
// its login instead of showing an empty guest home that reads as lost data, or '' once 손님으로 쓰기 was picked. Never
// set (a browser from before 손님 모드), an account's device cache stands for the first. Storage may be refused, which
// only loses the hint.
const ENTRY = 'risu-alpha:entry';
async function entry(): Promise<string | null> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(ENTRY);
  } catch {
    // A hint only.
  }
  if (stored !== null) return stored === '' ? null : stored;
  return (await cachedAccounts().catch(() => false)) ? '' : null;
}
function enterAs(username: string) {
  try {
    localStorage.setItem(ENTRY, username);
  } catch {
    // A hint only.
  }
}

// Signed out, the page opens as this browser's guest (design F1), unless it came from leaving an account or this
// browser has opened one before; guest: the person picked 손님으로 쓰기.
async function loadState(notice: string | null = null, prefer: 'auto' | 'guest' | 'login' = 'auto'): Promise<Loaded> {
  void clearDownloads();
  const result = await loadSession();
  if (!result.ok) return { kind: 'unreachable', message: describeFailure(result) };
  const boot = result.data;
  if (boot.session === null) {
    const known = prefer === 'auto' ? await entry() : null;
    if (prefer === 'login' || notice !== null || known !== null) return { kind: 'login', notice, username: known ?? '' };
    return { kind: 'guest', ...(await guestAccount()), signupOpen: boot.signupOpen, facts: guestFacts() };
  }
  const vaultKey = await recallVault(boot.session.accountId);
  if (vaultKey) return { kind: 'landing', session: boot.session, vaultKey };
  return { kind: 'locked', signedIn: boot, notice };
}

// children renders what is behind it, so account/ never imports the shell.
export function AccountFlow({ children }: { children: (unlocked: Unlocked) => ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  // The page holds the account it is signed in as, locked or not, and goes on holding it while it asks who it is now
  // (loading, unreachable): a request still leaving for that account stays refused. Once the server says the cookie
  // names another account, the page asks again and shows that one, which closes what was open. Unlocked, what answers
  // say of the account goes to its facts. A guest holds none: the server has no account of it.
  function show(next: State) {
    const facts = next.kind === 'unlocked' ? next.facts : null;
    if (next.kind === 'locked' || next.kind === 'recovered' || next.kind === 'unlocked') {
      const session = next.kind === 'locked' ? next.signedIn.session : next.session;
      holdAccount(session.accountId, (heard) => (heard.kind === 'elsewhere' ? reload(ELSEWHERE) : facts?.heard(heard)));
    } else if (next.kind !== 'loading' && next.kind !== 'unreachable' && next.kind !== 'moving') holdAccount(null);
    setState(next);
  }

  function settle(next: Loaded) {
    if (next.kind === 'landing') return land(next.session, next.vaultKey);
    else show(next);
  }

  function failed(error: unknown) {
    show({ kind: 'unreachable', message: describeFailure({ ok: false, error: error instanceof DatabaseBlocked ? 'browser-storage-blocked' : 'browser-storage' }) });
  }

  function reload(notice: string | null = null, prefer: 'auto' | 'guest' | 'login' = 'auto') {
    show({ kind: 'loading' });
    void loadState(notice, prefer).then(settle).catch(failed);
  }

  useEffect(() => {
    reload();
  }, []);

  const moving = (title: string) => (step: GuestTransferStep) =>
    setState((now) => (now.kind === 'moving' ? { kind: 'moving', moved: { title, steps: { ...now.moved.steps, [step.kind]: step } } } : now));

  // Every way into an account ends here, so what a guest made in this browser is never passed by: a guest whose upload
  // into this same account was cut off finishes it, and another guest's content waits for 올리기 or 버리기.
  async function land(session: SessionFacts, vaultKey: VaultKey) {
    try {
      const held = await guestWithContent();
      if (!held.ok) return show({ kind: 'unreachable', message: describeFailure(held) });
      const guest = held.data;
      if (guest?.accountId === session.accountId) {
        const title = '계정에 올리는 중';
        show({ kind: 'moving', moved: { title, steps: {} } });
        const uploaded = await uploadGuest(session.accountId, vaultKey, { progress: moving(title) });
        if (!uploaded.ok) return show({ kind: 'unreachable', message: describeFailure(uploaded) });
      } else if (guest) return show({ kind: 'guest-data', session, vaultKey, failure: null });
      await rememberVault(session.accountId, vaultKey);
      enterAs(session.username);
      show({ kind: 'unlocked', session, vaultKey, facts: new AccountFacts(session) });
    } catch (error) {
      failed(error);
    }
  }

  // A recovery key opens the vault but then asks for a new password, since the old one is lost.
  async function open(signedIn: SignedIn, credential: Credential): Promise<string | null> {
    const vaultKey = await openVault(signedIn.session.accountId, signedIn.vault, credential);
    if (!vaultKey) return wrongSecret(credential.method, false);
    if (credential.method === 'recovery') show({ kind: 'recovered', session: signedIn.session, vaultKey, current: credential });
    else await land(signedIn.session, vaultKey);
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
      return (
        <Screen top={<Brand />} align="center">
          <Progress hero title="불러오는 중" steps={[{ label: '계정 확인' }]} />
        </Screen>
      );
    case 'unreachable':
      return <UnreachableScreen message={state.message} onRetry={() => reload()} />;
    case 'moving':
      return <MovingScreen moved={state.moved} />;
    case 'guest':
      return children({
        accountId: state.accountId,
        username: GUEST_NAME,
        vaultKey: state.vaultKey,
        admin: false,
        localProviders: [],
        facts: state.facts,
        guest: {
          signupOpen: state.signupOpen,
          onSignup: () => show({ kind: 'signup', step: 'password', draft: null }),
          onSignIn: () => show({ kind: 'login', notice: null, username: '' }),
        },
      });
    case 'signup': {
      if (state.step === 'recovery') {
        const { draft } = state;
        const title = '계정 만드는 중';
        return (
          <RecoveryKeyScreen
            username={draft.username}
            recoveryKey={draft.recoveryKey}
            saved={state.failure !== null}
            failure={state.failure}
            onBack={() => show({ kind: 'signup', step: 'password', draft })}
            onStart={async () => {
              show({ kind: 'moving', moved: { title, steps: {} } });
              const result = await signUpGuest(draft, { progress: moving(title) });
              if (!result.ok) return show({ kind: 'signup', step: 'recovery', draft, failure: describeFailure(result) });
              await land(result.data, draft.vaultKey);
            }}
          />
        );
      }
      const { draft } = state;
      return (
        <PasswordScreen
          mode="signup"
          username={draft?.username ?? ''}
          onBack={() => reload(null, 'guest')}
          onSignIn={() => show({ kind: 'login', notice: null, username: '' })}
          onDone={async (typed, password) => {
            const username = canonicalUsername(typed);
            const prepared = await prepareGuestSignup(username, await passwordCredential(username, password));
            show({ kind: 'signup', step: 'recovery', draft: prepared, failure: null });
            return null;
          }}
        />
      );
    }
    case 'guest-data': {
      const { session, vaultKey } = state;
      const title = '계정에 올리는 중';
      return (
        <GuestDataScreen
          username={session.username}
          failure={state.failure}
          onUpload={async () => {
            show({ kind: 'moving', moved: { title, steps: {} } });
            const uploaded = await uploadGuest(session.accountId, vaultKey, { progress: moving(title) });
            if (!uploaded.ok) return show({ kind: 'guest-data', session, vaultKey, failure: describeFailure(uploaded) });
            await land(session, vaultKey);
          }}
          onDiscard={async () => {
            const discarded = await discardGuest();
            if (!discarded.ok) return describeFailure(discarded);
            await land(session, vaultKey);
            return null;
          }}
        />
      );
    }
    case 'login':
      return (
        <SignInScreen
          account={null}
          username={state.username}
          notice={state.notice}
          onGuest={() => {
            enterAs('');
            reload(null, 'guest');
          }}
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
            await land(session, vaultKey);
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
        localProviders: state.session.localProviders,
        facts: state.facts,
        vaultKey: state.vaultKey,
        guest: null,
        onLock: () => void lockVault().then(() => reload()),
        onLogout: () => logout(state.session.accountId),
      });
  }
}
