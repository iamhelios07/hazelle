import { useEffect, useState } from 'react';
import { connectionUsage, type ModelUsage } from '../../model/usage';
import { ACTS } from '../common/acts';
import { count } from '../common/typedNumber';
import { tally } from '../common/usage';
import { useSession } from '../session';
import { Button, Callout, Empty, Facts, Panel, Text } from '../ui';

const WINDOWS = [['hour', '지난 1시간'], ['today', '오늘'], ['week', '이번 주']] as const;

const sent = (usage: ModelUsage) =>
  usage.calls ? `응답 ${count(usage.calls)}회 · 입력 ${tally(usage.input, usage.calls)} · 출력 ${tally(usage.output, usage.calls)}` : '없음';

export function ConnectionSent({ connection, level }: { connection: string; level: 2 | 3 }) {
  const { usage: usageIndex } = useSession();
  const [attempt, setAttempt] = useState(0);
  const retry = () => setAttempt((held) => held + 1);
  const [usage, setUsage] = useState<ReturnType<typeof connectionUsage> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setUsage(null);
    setFailed(false);
    void usageIndex.read((chats) => connectionUsage(chats, connection, Date.now()), abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      if (result.ok) setUsage(result.data);
      else setFailed(true);
    });
    return () => abort.abort();
  }, [usageIndex, connection, attempt]);

  return (
    <Panel title="사용 내역" level={level} action={<Button variant="secondary" onClick={retry}>다시 집계</Button>}>
      <Text variant="note">남아 있는 채팅 기준</Text>
      {failed ? (
        <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: retry }}>
          사용 내역을 불러오지 못했어요.
        </Callout>
      ) : usage === null ? (
        <Text variant="note">사용 내역을 확인하는 중…</Text>
      ) : WINDOWS.some(([window]) => usage[window].calls) ? (
        <Facts items={WINDOWS.map(([window, label]) => ({ label, value: sent(usage[window]) }))} />
      ) : (
        <Empty variant="section">이번 주에 이 연결로 받은 응답이 없어요.</Empty>
      )}
    </Panel>
  );
}
