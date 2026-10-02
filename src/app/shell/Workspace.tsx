import { useEffect, useState, useSyncExternalStore } from 'react';
import { openSession, type Session } from '../../runtime/session';
import type { PullProgress } from '../../runtime/store';
import type { Unlocked } from '../account/AccountFlow';
import { UnreachableScreen } from '../account/UnreachableScreen';
import { describeFailure } from '../common/failure';
import { inSettings } from '../common/words';
import { ImportProvider } from '../library/ImportFlow';
import { SessionProvider } from '../session';
import { ToastProvider, type Standing } from '../toast';
import { Brand, Screen, Text } from '../ui';
import { BotNotes } from './BotNotes';
import { Layout } from './Layout';

const RECONNECTING: Standing = { message: '연결이 불안정해요', detail: '다시 닿으면 이어서 저장해요.' };
const SUSPENDED: Standing = {
  message: '운영자가 이 계정을 정지했어요',
  detail: `읽기는 그대로 되지만 저장과 모델 부르기는 막혀 있어요. ${inSettings('account')}에서 백업을 받거나 운영자에게 알리거나 탈퇴할 수 있어요.`,
};
const subscribeNothing = () => () => {};
const notWaiting = () => false;

// Everything behind an open vault is one session, opened before the first screen and closed when this unmounts,
// which 잠그기 and 로그아웃 both do.
export function Workspace({ accountId, vaultKey, username, ...account }: Unlocked) {
  const [session, setSession] = useState<Session | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<PullProgress>({ objects: 0, pages: 0 });
  const waiting = useSyncExternalStore(session?.store.subscribeWaiting ?? subscribeNothing, session?.store.waiting ?? notWaiting, notWaiting);

  useEffect(() => {
    const abandon = new AbortController();
    let opened: Session | null = null;
    setFailure(null);
    setProgress({ objects: 0, pages: 0 });
    void openSession(accountId, vaultKey, username, abandon.signal, (progress) => {
      if (!abandon.signal.aborted) setProgress(progress);
    }).then((result) => {
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

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => session.startBackground(), 0);
    return () => clearTimeout(timer);
  }, [session]);

  if (failure) return <UnreachableScreen message={failure} onRetry={() => setAttempt((count) => count + 1)} />;
  if (!session) return (
    <Screen top={<Brand />} align="center">
      <Text align="center">불러오는 중 · {progress.objects.toLocaleString('ko-KR')}개</Text>
    </Screen>
  );
  return (
    <SessionProvider session={session} account={account}>
      <ToastProvider standing={waiting ? RECONNECTING : account.suspended ? SUSPENDED : null}>
        <BotNotes />
        <ImportProvider>
          <Layout />
        </ImportProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
