import { useEffect, useState } from 'react';
import { openSession, type Session } from '../runtime/session';
import type { VaultKey } from '../vault/keys';
import { Layout } from './Layout';
import { describeFailure } from './screens/failure';
import { ImportProvider } from './screens/ImportFlow';
import { UnreachableScreen } from './screens/UnreachableScreen';
import { SessionProvider, type Account } from './session';
import { ToastProvider } from './toast';

type Props = Account & { accountId: string; vaultKey: VaultKey };

// Everything behind an open vault is one session (runtime/session), opened before the first screen and
// closed when this unmounts. 잠그기 and 로그아웃 both leave App's unlocked state, which unmounts this.
export function Workspace({ accountId, vaultKey, ...account }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abandon = new AbortController();
    let opened: Session | null = null;
    setFailure(null);
    void openSession(accountId, vaultKey, account.username, abandon.signal).then((result) => {
      if (abandon.signal.aborted) return;
      if (!result.ok) return setFailure(describeFailure(result));
      opened = result.data;
      setSession(opened);
    });
    return () => {
      abandon.abort();
      opened?.close();
    };
  }, [accountId, vaultKey, account.username, attempt]);

  if (failure) return <UnreachableScreen message={failure} onRetry={() => setAttempt((count) => count + 1)} />;
  if (!session) return null;
  return (
    <SessionProvider session={session} account={account}>
      <ToastProvider>
        <ImportProvider>
          <Layout />
        </ImportProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
