import { useEffect, useRef, useState } from 'react';
import type { ApiResult } from '../../runtime/api';
import { readServiceUsage, readTopCallers, type ServiceUsage, type TopCallers } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { Button, Callout, Empty, List, ListItem, Section, Text } from '../ui';
import { moment, times, utcDay } from './time';

// Whole-service totals are intentionally independent of list navigation and account/notice actions. A refresh
// walks bounded usage pages, retains just their sums and can stop without issuing the next page.
export function UsageSection() {
  const job = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [totals, setTotals] = useState<ServiceUsage | null>(null);
  const [top, setTop] = useState<ApiResult<TopCallers> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => () => job.current?.abort(), []);

  async function refresh() {
    const stop = new AbortController();
    job.current = stop;
    setBusy(true);
    setComplete(false);
    setFailure(null);
    setTotals(null);
    setTop(null);
    const [answer, ranked] = await Promise.all([readServiceUsage(setTotals, stop.signal), readTopCallers()]);
    if (job.current !== stop) return;
    job.current = null;
    setBusy(false);
    setComplete(answer.ok);
    setTop(ranked);
    if (!answer.ok && answer.error !== 'stopped') setFailure(describeFailure(answer));
  }

  return (
    <Section
      title="전체 사용량"
      action={busy
        ? <Button variant="secondary" size="sm" onClick={() => job.current?.abort()}>집계 멈추기</Button>
        : <Button variant="secondary" size="sm" onClick={() => void refresh()}>집계</Button>}
    >
      {totals
        ? <Text variant="note">{totals.accounts.toLocaleString('ko-KR')}명 확인 · 텍스트 {sizeText(totals.bytes)} · 디스크 {sizeText(totals.disk)} · {moment(totals.readAt)}부터 읽음{busy ? ' · 집계 중' : complete ? '' : ' · 중간 집계'}{totals.unread > 0 ? ` · ${totals.unread.toLocaleString('ko-KR')}명은 읽지 못해 합계에서 빠짐` : ''}</Text>
        : <Text variant="note">{busy ? '집계 중…' : '집계 전'}</Text>}
      {failure && <Callout tone="warn">{failure}</Callout>}
      {top && <Ranked top={top} />}
    </Section>
  );
}

function Ranked({ top }: { top: ApiResult<TopCallers> }) {
  if (!top.ok) {
    return (
      <Section level={3} title="최근 7일 많이 쓴 계정">
        <Callout tone="warn">{describeFailure(top)}</Callout>
      </Section>
    );
  }
  const { since, today, accounts } = top.data;
  const counting = since <= today;
  return (
    <Section level={3} title="최근 7일 많이 쓴 계정" note={counting ? `${utcDay(since)}부터` : undefined}>
      {!counting && <Empty variant="section">{utcDay(since)}부터 기록돼요.</Empty>}
      {counting && accounts.length === 0 && <Empty variant="section">호출한 계정이 없어요.</Empty>}
      {accounts.length > 0 && (
        <List label="최근 7일 많이 쓴 계정">
          {accounts.map((account) => (
            <ListItem key={account.accountId} title={account.username} aside={times(account.calls)} description={account.refused ? `거절 ${times(account.refused)}` : undefined} />
          ))}
        </List>
      )}
    </Section>
  );
}
