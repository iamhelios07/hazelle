import { useEffect, useState } from 'react';
import type { Connection, Meter, MeterReset, MeterUnit } from '../../connectors/types';
import { loadMeters, type MetersResult } from '../../runtime/meters';
import { describeMetersFailure } from '../common/failure';
import { creditAmount, credits, usd } from '../common/money';
import { Callout, Empty, Facts, Section, Text } from '../ui';

const RESETS: Record<Exclude<MeterReset, { at: number }>, string> = { daily: '매일 초기화', weekly: '매주 초기화', monthly: '매달 초기화' };

const number = (unit: MeterUnit, value: number) => (unit === 'credit' ? creditAmount(value) : value.toLocaleString('ko-KR'));
const figure = (unit: MeterUnit, value: number) =>
  unit === 'usd' ? usd(value) : unit === 'credit' ? credits(value) : `${number(unit, value)}회`;

const day = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });
const reset = (resets: MeterReset) => (typeof resets === 'string' ? RESETS[resets] : `${day.format(resets.at)} 초기화`);

// Out of a cap, what is left reads as "남음"; a balance with no cap needs no such word.
function fact(meter: Meter) {
  if (meter.kind === 'spent' || meter.limit === null) return { label: meter.label, value: figure(meter.unit, meter.amount) };
  const label = meter.resets ? `${meter.label} · ${reset(meter.resets)}` : meter.label;
  // A unit written after the number is said once, after the cap: "38 남음 / 50회".
  const amount = meter.unit === 'usd' ? usd(meter.amount) : number(meter.unit, meter.amount);
  return { label, value: `${amount} 남음 / ${figure(meter.unit, meter.limit)}` };
}

// For a connection whose type reports meters (runtime reportsMeters).
export function ConnectionMeters({ connection }: { connection: Connection }) {
  const [result, setResult] = useState<MetersResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  const key = JSON.stringify([connection.type, connection.baseUrl, connection.secret]);
  useEffect(() => {
    const abort = new AbortController();
    setResult(null);
    void loadMeters(connection, abort.signal)?.then((loaded) => abort.signal.aborted || setResult(loaded));
    return () => abort.abort();
    // The stored object is replaced on every sync; only a change to its address or key asks again.
  }, [key, attempt]);

  return (
    <Section title="사용량과 한도">
      {!result ? (
        <Text size="sm" tone="muted">
          불러오는 중…
        </Text>
      ) : !result.ok ? (
        <Callout tone="warn" action={{ label: '사용량 다시 불러오기', onClick: () => setAttempt((count) => count + 1) }}>
          {describeMetersFailure(result.failure)}
        </Callout>
      ) : result.meters.length ? (
        <Facts items={result.meters.map(fact)} />
      ) : (
        <Empty variant="section">이 연결은 사용량을 알려 주지 않았어요.</Empty>
      )}
    </Section>
  );
}
