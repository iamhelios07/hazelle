import type { CallKind } from '../../contracts/admin';
import { readCalls, type AccountCalls, type AdminAccount } from '../../runtime/admin';
import { timeOfDay } from '../common/time';
import { useLoaded } from '../common/useLoaded';
import { Callout, Dialog, Empty, List, ListItem, Section } from '../ui';

const DAY_MS = 24 * 60 * 60 * 1000;
// A count's day is a UTC day, so its date reads in UTC whatever this device's zone.
export const callDay = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format;
export const times = (count: number) => `${count.toLocaleString('ko-KR')}회`;

const KINDS: [CallKind, string][] = [['generate', '응답'], ['bot', '봇'], ['short', '기타']];

export function CallsDialog({ account, onClose }: { account: Pick<AdminAccount, 'accountId' | 'username'>; onClose: () => void }) {
  const loaded = useLoaded(() => readCalls(account.accountId));
  const calls = loaded.data?.calls;
  return (
    <Dialog title={`${account.username} 호출 기록`} onClose={onClose}>
      {loaded.failure && <Callout tone="warn" action={{ label: '다시 불러오기', onClick: loaded.reload }}>{loaded.failure}</Callout>}
      {calls === null && <Empty>삭제된 계정이에요.</Empty>}
      {calls && <Days calls={calls} />}
    </Dialog>
  );
}

function Days({ calls: { since, today, days } }: { calls: AccountCalls }) {
  if (since > today) return <Empty>{callDay(since)}부터 기록돼요.</Empty>;
  const counts = new Map(days.map(({ day, kind, calls }) => [`${day}:${kind}`, calls]));
  const count = (day: number, kind: CallKind) => counts.get(`${day}:${kind}`) ?? 0;
  const sum = (refused: boolean) => days.reduce((total, { kind, calls }) => total + ((kind === 'refused') === refused ? calls : 0), 0);
  const refused = sum(true);
  return (
    <Section
      level={3}
      title="날짜별 호출"
      note={`${times(sum(false))}${refused ? ` · 거절 ${times(refused)}` : ''}`}
      hint={`날짜는 ${timeOfDay(today)}에 바뀌고, 기타는 모델 목록이나 사용량 조회 같은 호출이에요.`}
    >
      <List label="날짜별 호출">
        {Array.from({ length: (today - since) / DAY_MS + 1 }, (_, index) => today - index * DAY_MS).map((day) => (
          <ListItem
            key={day}
            title={callDay(day)}
            tags={day === today ? ['오늘'] : []}
            description={[...KINDS.map(([kind, label]) => `${label} ${count(day, kind)}`), ...(count(day, 'refused') ? [`거절 ${count(day, 'refused')}`] : [])].join(' · ')}
          />
        ))}
      </List>
    </Section>
  );
}
