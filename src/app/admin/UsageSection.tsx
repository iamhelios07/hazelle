import { useEffect, useRef, useState } from 'react';
import { readServiceUsage, type ServiceUsage } from '../../runtime/admin';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { Button, Callout, Section, Text } from '../ui';
import { moment } from './time';

// Whole-service totals are intentionally independent of list navigation and account/notice actions. A refresh
// walks bounded usage pages, retains just their sums and can stop without issuing the next page.
export function UsageSection() {
  const job = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [totals, setTotals] = useState<ServiceUsage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => () => job.current?.abort(), []);

  async function refresh() {
    const stop = new AbortController();
    job.current = stop;
    setBusy(true);
    setComplete(false);
    setFailure(null);
    setTotals(null);
    const answer = await readServiceUsage(setTotals, stop.signal);
    if (job.current !== stop) return;
    job.current = null;
    setBusy(false);
    setComplete(answer.ok);
    if (!answer.ok && answer.error !== 'stopped') setFailure(describeFailure(answer));
  }

  return (
    <Section
      title="전체 사용량"
      action={busy
        ? <Button variant="secondary" onClick={() => job.current?.abort()}>집계 멈추기</Button>
        : <Button variant="secondary" onClick={() => void refresh()}>집계</Button>}
    >
      {totals
        ? <Text variant="note">{totals.accounts.toLocaleString('ko-KR')}명 확인 · 텍스트 {sizeText(totals.bytes)} · 디스크 {sizeText(totals.disk)} · {moment(totals.readAt)}부터 읽음{busy ? ' · 집계 중' : complete ? '' : ' · 중간 집계'}{totals.unread > 0 ? ` · ${totals.unread.toLocaleString('ko-KR')}명은 읽지 못해 합계에서 빠짐` : ''}</Text>
        : <Text variant="note">{busy ? '집계 중…' : '집계 전'}</Text>}
      {failure && <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => void refresh() }}>{failure}</Callout>}
    </Section>
  );
}
