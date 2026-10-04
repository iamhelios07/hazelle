import { useEffect, useState } from 'react';
import { connectionUsage, type ModelUsage, type UsageWindow } from '../../model/chat';
import { tally } from '../common/usage';
import { useSession } from '../session';
import { Button, Empty, Facts, Section, Text } from '../ui';

const WINDOWS: [UsageWindow, string][] = [['hour', '지난 1시간'], ['today', '오늘'], ['week', '이번 주']];

const sent = (usage: ModelUsage) =>
  usage.calls ? `답장 ${usage.calls.toLocaleString('ko-KR')}번 · 입력 ${tally(usage.input, usage.calls)} · 출력 ${tally(usage.output, usage.calls)}` : '없음';

export function ConnectionSent({ connection }: { connection: string }) {
  const { usage: usageIndex } = useSession();
  const [attempt, retry] = useState(0);
  const [usage, setUsage] = useState<Record<UsageWindow, ModelUsage> | null>(null);
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
    <Section title="보낸 양" note="남아 있는 채팅 기준" action={<Button variant="secondary" size="sm" onClick={() => retry((count) => count + 1)}>다시 집계</Button>}>
      {usage === null ? (
        <Text>{failed ? '보낸 양을 불러오지 못했어요.' : '보낸 양을 확인하는 중'}</Text>
      ) : WINDOWS.some(([window]) => usage[window].calls) ? (
        <Facts items={WINDOWS.map(([window, label]) => ({ label, value: sent(usage[window]) }))} />
      ) : (
        <Empty variant="section">이번 주에 이 연결로 받은 답장이 없어요.</Empty>
      )}
    </Section>
  );
}
