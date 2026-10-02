import { useState } from 'react';
import { setService, type Service } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, NumberInput, Section, SettingGroup, SettingRow } from '../ui';
import { capText, megabytes, typedCap, typedCount } from './bytes';

// The operator raises the cap in steps, so each cap sits with the count it bounds.
export function ServiceSection({ service, onSaved }: { service: Service; onSaved: () => void }) {
  // null: not typed in, so the field shows the server's value.
  const [seats, setSeats] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  const { busy, failure, run } = useAttempt();
  const signupCap = seats === null ? service.signupCap : typedCount(seats);
  const accountBytesCap = cap === null ? service.accountBytesCap : typedCap(cap);
  const valid = signupCap !== undefined && accountBytesCap !== undefined;
  const changed = signupCap !== service.signupCap || accountBytesCap !== service.accountBytesCap;

  const save = () =>
    run(async () => {
      const saved = await setService({ signupCap: signupCap!, accountBytesCap: accountBytesCap! });
      if (!saved.ok) return describeFailure(saved);
      setSeats(null);
      setCap(null);
      onSaved();
      return null;
    });

  return (
    <Section
      title="서비스"
      action={
        <Button variant="secondary" size="sm" busy={busy} disabled={!valid || !changed} onClick={() => void save()}>
          저장
        </Button>
      }
    >
      <SettingGroup label="서비스">
        <SettingRow
          label="가입 정원"
          help="계정 수가 이보다 적은 동안 새 계정을 만들 수 있어요."
          sub={`지금 ${service.accounts.toLocaleString('ko-KR')}명`}
          error={signupCap === undefined ? '0 이상의 정수로 넣어 주세요.' : undefined}
          control={<NumberInput label="가입 정원" unit="명" value={seats ?? String(service.signupCap)} invalid={signupCap === undefined} onChange={setSeats} />}
        />
        <SettingRow
          label="계정당 저장 한도"
          help="한 계정이 저장한 내용의 크기 한도예요. 비우면 한도가 없어요. 그림 파일은 세지 않아요."
          sub={`모든 계정 합계 ${megabytes(service.bytes)}`}
          error={accountBytesCap === undefined ? 'MB 단위의 0 이상인 수로 넣어 주세요.' : undefined}
          control={<NumberInput label="계정당 저장 한도" unit="MB" placeholder="없음" value={cap ?? capText(service.accountBytesCap)} invalid={accountBytesCap === undefined} onChange={setCap} />}
        />
      </SettingGroup>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Section>
  );
}
