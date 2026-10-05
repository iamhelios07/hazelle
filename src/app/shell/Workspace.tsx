import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { openSession, type Session } from '../../runtime/session';
import type { PullProgress } from '../../runtime/store';
import type { Unlocked } from '../account/AccountFlow';
import { UnreachableScreen } from '../account/UnreachableScreen';
import { describeFailure } from '../common/failure';
import { DisplayProvider } from '../display';
import { BIN, inSettings, NOTICES } from '../common/words';
import { ImportProvider } from '../library/ImportFlow';
import { SessionProvider } from '../session';
import { ToastProvider, useToast, type Standing } from '../toast';
import { Brand, Progress, Screen, Text } from '../ui';
import { BotNotes } from './BotNotes';
import { Layout } from './Layout';
import { navigate } from './router';

const RECONNECTING: Standing = { message: '연결이 불안정해요', detail: '다시 닿으면 이어서 불러오고 저장해요.' };
const SUSPENDED: Standing = {
  message: '운영자가 이 계정을 정지했어요',
  detail: `읽기는 그대로 되지만 저장과 모델 부르기는 막혀 있어요. ${inSettings('account')}에서 ${NOTICES.from}을 보거나 백업을 받거나 운영자에게 알리거나 탈퇴할 수 있어요.`,
};
// Said once, and standing until the account shrinks: each refused write saying it again would be a stream of toasts.
const FULL: Standing = { message: '저장 공간이 가득 찼어요', detail: `새로 만든 것은 저장되지 않아요. 지운 것을 ${BIN}에서 완전히 지우면 자리가 생겨요.` };
// Ahead of 연결이 불안정해요: calls wait out a restore as they wait out a dropped connection.
const RESTORING: Standing = { message: '계정을 복원하는 중이에요', detail: '' };
const subscribeNothing = () => () => {};
const NOT_PULLED: PullProgress = { objects: 0, pages: 0, waiting: false };
const notWaiting = () => false;

// Said once each time the store hears the account was restored: what the tab shows was loaded again, and the writes
// the restore dropped are counted.
function Restored({ store }: { store: Session['store'] }) {
  const toast = useToast();
  useEffect(() => store.subscribeRewound((dropped) => toast.show('계정을 복원해서 다시 불러왔어요', dropped ? { detail: `방금 바꾼 내용 ${dropped}개는 저장되지 않았어요` } : {})), [store, toast]);
  return null;
}

// Said once when the session opens with notices the person has not seen. The ref: StrictMode runs a mount's effect twice.
function Unread({ count }: { count: number }) {
  const toast = useToast();
  const said = useRef(false);
  useEffect(() => {
    if (!count || said.current) return;
    said.current = true;
    toast.show(`${NOTICES.from}이 ${count.toLocaleString('ko-KR')}개 있어요`, { action: { label: '보기', onClick: () => navigate({ kind: 'account', section: 'notices' }) } });
  }, []);
  return null;
}

// Everything behind an open vault is one session, opened before the first screen and closed when this unmounts,
// which 잠그기 and 로그아웃 both do.
export function Workspace({ accountId, vaultKey, username, unreadNotices, ...account }: Unlocked) {
  const [session, setSession] = useState<Session | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [progress, setProgress] = useState<PullProgress>(NOT_PULLED);
  const waiting = useSyncExternalStore(session?.store.subscribeWaiting ?? subscribeNothing, session?.store.waiting ?? notWaiting, notWaiting);
  // The notice alone, not the facts, so the counts every write brings render nothing here.
  const { facts } = account;
  const noticeOf = () => {
    const { restoring, suspended, full } = facts.snapshot();
    return restoring ? RESTORING : suspended ? SUSPENDED : full ? FULL : null;
  };
  const notice = useSyncExternalStore(facts.subscribe, noticeOf, noticeOf);

  useEffect(() => {
    const abandon = new AbortController();
    let opened: Session | null = null;
    setFailure(null);
    setProgress(NOT_PULLED);
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
      <Progress steps={[{ label: '불러오는 중', done: progress.objects }]} />
      {progress.waiting && <Text variant="note" align="center">{RECONNECTING.message} · {RECONNECTING.detail}</Text>}
    </Screen>
  );
  return (
    <SessionProvider session={session} account={account}>
      <ToastProvider standing={notice !== RESTORING && waiting ? RECONNECTING : notice}>
        <Restored store={session.store} />
        <Unread count={unreadNotices} />
        <BotNotes />
        <DisplayProvider>
          <ImportProvider>
            <Layout />
          </ImportProvider>
        </DisplayProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
