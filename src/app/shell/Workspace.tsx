import { useEffect, useState } from 'react';
import { openSession, type Session } from '../../runtime/session';
import type { Unlocked } from '../account/AccountFlow';
import { UnreachableScreen } from '../account/UnreachableScreen';
import { describeFailure } from '../common/failure';
import { ImportProvider } from '../library/ImportFlow';
import { SessionProvider } from '../session';
import { ToastProvider } from '../toast';
import { Layout } from './Layout';

// Everything behind an open vault is one session, opened before the first screen and closed when this unmounts,
// which 잠그기 and 로그아웃 both do.
export function Workspace({ accountId, vaultKey, username, ...account }: Unlocked) {
  const [session, setSession] = useState<Session | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abandon = new AbortController();
    let opened: Session | null = null;
    setFailure(null);
    void openSession(accountId, vaultKey, username, abandon.signal).then((result) => {
      if (abandon.signal.aborted) return;
      if (!result.ok) return setFailure(describeFailure(result));
      opened = result.data;
      setSession(opened);
    });
    return () => {
      abandon.abort();
      opened?.close();
    };
  }, [accountId, vaultKey, username, attempt]);

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
