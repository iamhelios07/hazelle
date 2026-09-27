import { useCallback, useEffect, useRef, useState } from 'react';
import { createVault, openWithPassphrase, openWithRecoveryKey, wrapWithPassphrase, type VaultKey, type VaultRecord } from '../vault/keys';
import { forgetVault, recallVault, rememberVault } from '../vault/device';
import { api } from './api';
import { AccountScreen } from './screens/AccountScreen';
import { describeFailure } from './screens/failure';
import { HomeScreen } from './screens/HomeScreen';
import { RecoveryKeyScreen } from './screens/RecoveryKeyScreen';
import { UnlockScreen } from './screens/UnlockScreen';
import { UnreachableScreen } from './screens/UnreachableScreen';
import { VaultPassphraseScreen } from './screens/VaultPassphraseScreen';

type Session = { accountId: string; username: string };
type Draft = { record: VaultRecord; vaultKey: VaultKey; recoveryKey: string };

type State =
  | { kind: 'loading' }
  | { kind: 'unreachable'; message: string }
  | { kind: 'signed-out'; signupOpen: boolean }
  | { kind: 'vault-setup'; session: Session; step: 'passphrase' | 'recovery'; draft: Draft | null }
  | { kind: 'locked'; session: Session; record: VaultRecord }
  | { kind: 'recovered'; session: Session; vaultKey: VaultKey }
  | { kind: 'unlocked'; session: Session; vaultKey: VaultKey; message: string | null };

async function loadState(): Promise<State> {
  const session = await api<Session>('GET', 'session');
  if (!session.ok) {
    if (session.error !== 'no-session') return { kind: 'unreachable', message: describeFailure(session) };
    const signup = await api<{ open: boolean }>('GET', 'signup');
    if (!signup.ok) return { kind: 'unreachable', message: describeFailure(signup) };
    return { kind: 'signed-out', signupOpen: signup.data.open };
  }
  const vault = await api<VaultRecord>('GET', 'vault');
  if (!vault.ok) {
    if (vault.error === 'no-vault') return { kind: 'vault-setup', session: session.data, step: 'passphrase', draft: null };
    return { kind: 'unreachable', message: describeFailure(vault) };
  }
  const vaultKey = await recallVault(session.data.accountId);
  if (vaultKey) return { kind: 'unlocked', session: session.data, vaultKey, message: null };
  return { kind: 'locked', session: session.data, record: vault.data };
}

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  // Kept only between signing in and finishing the vault setup, to refuse it as the vault passphrase.
  const loginPassword = useRef<string | null>(null);

  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    void loadState().then(setState);
  }, []);

  useEffect(() => {
    void loadState().then(setState);
  }, []);

  async function unlocked(session: Session, vaultKey: VaultKey) {
    await rememberVault(session.accountId, vaultKey);
    loginPassword.current = null;
    setState({ kind: 'unlocked', session, vaultKey, message: null });
  }

  async function logout(): Promise<string | null> {
    const result = await api('POST', 'logout');
    if (!result.ok) return describeFailure(result);
    await forgetVault();
    loginPassword.current = null;
    setState({ kind: 'signed-out', signupOpen: false });
    return null;
  }

  switch (state.kind) {
    case 'loading':
      return null;
    case 'unreachable':
      return <UnreachableScreen message={state.message} onRetry={reload} />;
    case 'signed-out':
      return (
        <AccountScreen
          mode={state.signupOpen ? 'signup' : 'login'}
          onSignedIn={(password) => {
            loginPassword.current = password;
            reload();
          }}
        />
      );
    case 'vault-setup': {
      const { session, draft } = state;
      if (state.step === 'recovery' && draft) {
        return (
          <RecoveryKeyScreen
            username={session.username}
            recoveryKey={draft.recoveryKey}
            onBack={() => setState({ ...state, step: 'passphrase' })}
            onStart={async () => {
              const result = await api('POST', 'vault', draft.record);
              if (result.ok) await unlocked(session, draft.vaultKey);
              else if (result.error === 'vault-exists') reload();
              else return describeFailure(result);
              return null;
            }}
          />
        );
      }
      return (
        <VaultPassphraseScreen
          mode="setup"
          loginPassword={loginPassword.current}
          onDone={async (passphrase) => {
            // Going back from the recovery step keeps the vault key and recovery key, so a file
            // already downloaded stays valid; only the passphrase wrap is redone.
            const next = draft
              ? { ...draft, record: { ...draft.record, ...(await wrapWithPassphrase(session.accountId, draft.vaultKey, passphrase)) } }
              : await createVault(session.accountId, passphrase);
            setState({ kind: 'vault-setup', session, step: 'recovery', draft: next });
            return null;
          }}
        />
      );
    }
    case 'locked': {
      const { session, record } = state;
      return (
        <UnlockScreen
          onPassphrase={async (passphrase) => {
            const vaultKey = await openWithPassphrase(session.accountId, record, passphrase);
            if (vaultKey) await unlocked(session, vaultKey);
            return vaultKey !== null;
          }}
          onRecoveryKey={async (text) => {
            const vaultKey = await openWithRecoveryKey(session.accountId, record, text);
            if (vaultKey) setState({ kind: 'recovered', session, vaultKey });
            return vaultKey !== null;
          }}
          onLogout={() => void logout().then((failure) => failure && setState({ kind: 'unreachable', message: failure }))}
        />
      );
    }
    case 'recovered': {
      const { session, vaultKey } = state;
      return (
        <VaultPassphraseScreen
          mode="reset"
          loginPassword={loginPassword.current}
          onDone={async (passphrase) => {
            const result = await api('PUT', 'vault/passphrase', await wrapWithPassphrase(session.accountId, vaultKey, passphrase));
            if (!result.ok) return describeFailure(result);
            await unlocked(session, vaultKey);
            return null;
          }}
        />
      );
    }
    case 'unlocked':
      return (
        <HomeScreen
          message={state.message}
          onLock={() => void forgetVault().then(reload)}
          onLogout={() => void logout().then((failure) => failure && setState({ ...state, message: failure }))}
        />
      );
  }
}
