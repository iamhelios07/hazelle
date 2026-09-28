import { useEffect, useState } from 'react';
import type { Connection, Meter } from '../../connectors/types';
import { loadMeters, type MetersResult } from '../../runtime/meters';
import { Button, Callout, Facts, Section, Stack, Text } from '../ui';
import { describeMetersFailure } from './failure';
import { usd } from './money';

const RESETS: Record<NonNullable<Meter['resets']>, string> = { daily: '매일 초기화', weekly: '매주 초기화', monthly: '매달 초기화' };

const figure = (unit: Meter['unit'], value: number) => (unit === 'usd' ? usd(value) : `${value.toLocaleString('ko-KR')}회`);

// A capped meter reads as what is left of the cap.
function fact(meter: Meter) {
  const value =
    meter.limit === null ? figure(meter.unit, meter.used) : `${figure(meter.unit, Math.max(meter.limit - meter.used, 0))} 남음 / ${figure(meter.unit, meter.limit)}`;
  return { label: meter.resets ? `${meter.label} · ${RESETS[meter.resets]}` : meter.label, value };
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
        <Stack gap={12}>
          <Callout tone="warn">{describeMetersFailure(result.failure)}</Callout>
          <Button variant="secondary" size="md" onClick={() => setAttempt((count) => count + 1)}>
            사용량 다시 불러오기
          </Button>
        </Stack>
      ) : result.meters.length ? (
        <Facts items={result.meters.map(fact)} />
      ) : (
        <Text size="sm" tone="muted">
          이 연결은 사용량을 알려 주지 않았어요.
        </Text>
      )}
    </Section>
  );
}
