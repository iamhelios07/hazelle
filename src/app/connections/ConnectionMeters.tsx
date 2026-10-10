import { useEffect, useState } from 'react';
import { resolveConnection } from '../../connectors/registry';
import type { Account, Connection, Meter, MeterReset, MeterUnit } from '../../connectors/types';
import type { MetersResult } from '../../runtime/meters';
import { pace, verdict } from '../../model/pace';
import { ACTS } from '../common/acts';
import { describeMetersFailure } from '../common/failure';
import { creditAmount, usd } from '../common/money';
import { monthDay } from '../common/time';
import { useSession } from '../session';
import { Callout, Empty, Gauge, Link, Section, Stack, Text } from '../ui';

const RESETS: Record<Exclude<MeterReset, { at: number }>, string> = { daily: '매일 초기화', weekly: '매주 초기화', monthly: '매달 초기화' };
const reset = (resets: MeterReset) => (typeof resets === 'string' ? RESETS[resets] : `${monthDay(resets.at)} 초기화`);

// At a glance: whole numbers from ten up, so 812.4 reads 812.
const plain = (value: number) => (value >= 10 ? Math.round(value).toLocaleString('ko-KR') : creditAmount(value));
const UNITS: Record<Exclude<MeterUnit, 'usd'>, string> = { credit: ' 크레딧', requests: '회', tokens: ' 토큰', concurrency: '', percent: '%' };
const figure = (unit: MeterUnit, value: number) => (unit === 'usd' ? usd(value) : `${plain(value)}${UNITS[unit]}`);
const amount = (unit: MeterUnit, value: number) => (unit === 'usd' || unit === 'percent' ? figure(unit, value) : plain(value));

// What is left of the first allowance, as a row elsewhere names it; null where there is none.
export function leftOf(result: MetersResult): string | null {
  const meter = result.meters.find((entry) => entry.kind === 'left');
  return meter ? `${amount(meter.unit, meter.amount)} 남음` : null;
}

const VERDICT = { fast: { status: '빠르게 쓰는 중', tone: 'accent' }, even: { status: '적정', tone: 'plain' }, slow: { status: '여유 있음', tone: 'plain' } } as const;

// turn: the window its group serves, for an account in a pool. waiting: its group's turn has not come. labeled: false
// where the place above names the allowance already.
export function MeterGauge({ meter, turn = null, waiting = false, labeled = true }: { meter: Meter; turn?: { start: number; end: number } | null; waiting?: boolean; labeled?: boolean }) {
  if (meter.kind === 'spent') return <Gauge label={meter.label} amount={amount(meter.unit, meter.amount)} of="사용" />;
  const label = labeled ? (meter.resets ? `${meter.label} · ${reset(meter.resets)}` : meter.label) : undefined;
  if (meter.limit === null) return <Gauge label={label} amount={amount(meter.unit, meter.amount)} of="남음" />;
  const left = { amount: amount(meter.unit, meter.amount), of: meter.unit === 'percent' ? '남음' : `/ ${figure(meter.unit, meter.limit)} 남음`, share: (meter.limit - meter.amount) / meter.limit };
  if (meter.amount <= 0) {
    const back = meter.resets === null ? undefined : reset(meter.resets);
    return <Gauge label={label} {...left} tone="warn" status="소진" note={back} />;
  }
  if (waiting) return <Gauge label={label} {...left} status="차례 전" />;
  const paced = pace(meter, Date.now(), turn);
  if (!paced) return <Gauge label={label} {...left} />;
  const { status, tone } = VERDICT[verdict(paced)];
  const note = `${paced.endsAtSwitch ? '차례 끝까지' : '초기화까지'} 하루 ${figure(meter.unit, paced.perDay)}씩`;
  return <Gauge label={label} {...left} mark={paced.even / 100} status={status} tone={tone} note={note} />;
}

// An account's meters as the pool holds them (runtime/pool), so the pick reads what is shown. null while they load.
export function useMeters(connection: Connection, account: Account): { result: MetersResult | null; retry: () => void } {
  const { credentials } = useSession();
  const [result, setResult] = useState<MetersResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([connection.type, connection.baseUrl, account.secret]);
  useEffect(() => {
    let current = true;
    setResult(null);
    void credentials.pool.meters(connection, account, { fresh: attempt > 0 })?.then((loaded) => current && setResult(loaded));
    return () => {
      current = false;
    };
    // The stored object is replaced on every sync; only a change to its address or key asks again.
  }, [key, attempt]);
  return { result, retry: () => setAttempt((count) => count + 1) };
}

export function ConnectionMeters({ connection }: { connection: Connection }) {
  const type = resolveConnection(connection)?.type;
  if (!type?.meters && !type?.usagePage) return null;
  return (
    <Section title="사용량과 한도">
      {type.meters && <Figures connection={connection} account={connection.accounts[0]!} />}
      {type.usagePage && <Link href={type.usagePage}>사용량 페이지</Link>}
    </Section>
  );
}

function Figures({ connection, account }: { connection: Connection; account: Account }) {
  const { result, retry: again } = useMeters(connection, account);
  const retry = { label: ACTS.retry.label, onClick: again };
  if (!result) return <Text variant="note">불러오는 중…</Text>;
  const [failure] = result.failures;
  if (!result.meters.length) {
    return failure ? <Callout tone="warn" action={retry}>{describeMetersFailure(failure)}</Callout> : <Empty variant="section">사용량 정보가 없어요.</Empty>;
  }
  return (
    <>
      <Stack gap="group">
        {result.meters.map((meter) => (
          <MeterGauge key={`${meter.kind}:${meter.label}`} meter={meter} />
        ))}
      </Stack>
      {failure && <Callout tone="warn" action={retry}>사용량 일부를 불러오지 못했어요.</Callout>}
    </>
  );
}
