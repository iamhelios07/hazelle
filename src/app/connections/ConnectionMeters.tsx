import { useEffect, useState } from 'react';
import { resolveConnection } from '../../connectors/registry';
import type { Account, Connection, Meter, MeterReset, MeterUnit } from '../../connectors/types';
import type { MetersResult } from '../../runtime/meters';
import { describeMetersFailure } from '../common/failure';
import { creditAmount, money, usd } from '../common/money';
import { monthDay } from '../common/time';
import { useSession } from '../session';
import { Callout, Empty, Facts, Link, Section, Text } from '../ui';

const RESETS: Record<Exclude<MeterReset, { at: number }>, string> = { daily: '매일 초기화', weekly: '매주 초기화', monthly: '매달 초기화' };

const number = (unit: MeterUnit, value: number) => (unit === 'credit' ? creditAmount(value) : value.toLocaleString('ko-KR'));
export function figure(unit: MeterUnit, value: number): string {
  switch (unit) {
    case 'requests':
      return `${number(unit, value)}회`;
    case 'tokens':
      return `${number(unit, value)} 토큰`;
    case 'concurrency':
      return number(unit, value);
    case 'usd':
    case 'credit':
      return money(unit, value);
  }
}

const reset = (resets: MeterReset) => (typeof resets === 'string' ? RESETS[resets] : `${monthDay(resets.at)} 초기화`);

export function fact(meter: Meter) {
  if (meter.kind === 'spent' || meter.limit === null) return { label: meter.label, value: figure(meter.unit, meter.amount) };
  const label = meter.resets ? `${meter.label} · ${reset(meter.resets)}` : meter.label;
  const amount = meter.unit === 'usd' ? usd(meter.amount) : number(meter.unit, meter.amount);
  return { label, value: `${amount} 남음 / ${figure(meter.unit, meter.limit)}` };
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
  const retry = { label: '사용량 다시 불러오기', onClick: again };
  if (!result) return <Text variant="note">불러오는 중…</Text>;
  const [failure] = result.failures;
  if (!result.meters.length) {
    return failure ? <Callout tone="warn" action={retry}>{describeMetersFailure(failure)}</Callout> : <Empty variant="section">이 연결은 사용량을 알려 주지 않았어요.</Empty>;
  }
  return (
    <>
      <Facts items={result.meters.map(fact)} />
      {failure && <Callout tone="warn" action={retry}>사용량 일부를 불러오지 못했어요.</Callout>}
    </>
  );
}
