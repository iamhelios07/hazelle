import { Send } from 'lucide-react';
import { useState } from 'react';
import { sendNotice, setService, type Service } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { count } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { NOTICES } from '../common/words';
import { useToast } from '../toast';
import { Button, Callout, Columns, NumberInput, Panel, Section, SettingCard } from '../ui';
import { CAP_ERROR, capText, typedCap, typedCount } from './bytes';
import { NoticeDialog } from './NoticeDialog';

// The operator raises the cap in steps, so each cap sits with the count it bounds. onNoticed: null where no one else
// would read a notice (moderation).
export function ServiceSection({ service, onSaved, onNoticed }: { service: Service; onSaved: () => void; onNoticed: (() => void) | null }) {
  // null: not typed in, so the field shows the server's value.
  const [seats, setSeats] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  const [fileCap, setFileCap] = useState<string | null>(null);
  const { busy, failure, run } = useAttempt();
  const signupCap = seats === null ? service.signupCap : typedCount(seats);
  const accountBytesCap = cap === null ? service.accountBytesCap : typedCap(cap);
  const accountFileBytesCap = fileCap === null ? service.accountFileBytesCap : typedCap(fileCap);
  const valid = signupCap !== undefined && accountBytesCap !== undefined && accountFileBytesCap !== undefined;
  const changed = signupCap !== service.signupCap || accountBytesCap !== service.accountBytesCap || accountFileBytesCap !== service.accountFileBytesCap;

  const save = () =>
    run(async () => {
      const saved = await setService({ signupCap: signupCap!, accountBytesCap: accountBytesCap!, accountFileBytesCap: accountFileBytesCap! });
      if (!saved.ok) return describeFailure(saved);
      setSeats(null);
      setCap(null);
      setFileCap(null);
      onSaved();
      return null;
    });

  return (
    <Section
      title="서비스"
      action={
        <Button variant="secondary" busy={busy} disabled={!valid || !changed} onClick={() => void save()}>
          저장
        </Button>
      }
    >
      <Columns>
        <SettingCard
          label="가입 정원"
          help="계정 수가 정원보다 적을 때만 가입할 수 있어요."
          sub={`지금 ${count(service.accounts)}명`}
          error={signupCap === undefined ? '0 이상의 정수를 입력해 주세요.' : undefined}
        >
          <NumberInput label="가입 정원" unit="명" value={seats ?? String(service.signupCap)} invalid={signupCap === undefined} onChange={setSeats} />
        </SettingCard>
        <SettingCard label="계정당 텍스트 한도" help="이미지를 제외한 계정별 저장 용량이에요." error={accountBytesCap === undefined ? CAP_ERROR : undefined}>
          <NumberInput label="계정당 텍스트 한도" unit="MB" placeholder="없음" value={cap ?? capText(service.accountBytesCap)} invalid={accountBytesCap === undefined} onChange={setCap} />
        </SettingCard>
        <SettingCard
          label="계정당 이미지 한도"
          help="계정별로 올린 이미지의 총 크기예요. 이미지를 삭제해도 줄지 않아요."
          sub={`저장된 이미지 합계 ${sizeText(service.fileBytes)}`}
          error={accountFileBytesCap === undefined ? CAP_ERROR : undefined}
        >
          <NumberInput label="계정당 이미지 한도" unit="MB" placeholder="없음" value={fileCap ?? capText(service.accountFileBytesCap)} invalid={accountFileBytesCap === undefined} onChange={setFileCap} />
        </SettingCard>
        {onNoticed && <NoticeEveryone onNoticed={onNoticed} />}
      </Columns>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Section>
  );
}

function NoticeEveryone({ onNoticed }: { onNoticed: () => void }) {
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  return (
    <Panel
      title={`모두에게 ${NOTICES.send}`}
      level={3}
      help="지금 있는 계정이 모두 받아요."
      action={
        <Button variant="secondary" icon={Send} onClick={() => setWriting(true)}>
          보내기
        </Button>
      }
    >
      {writing && (
        <NoticeDialog
          title={`모두에게 ${NOTICES.send}`}
          label="보낼 내용"
          confirm={{ label: '보내기', icon: Send }}
          send={(text) => sendNotice(null, text)}
          onSent={() => {
            setWriting(false);
            toast.show('모두에게 보냈어요.');
            onNoticed();
          }}
          onClose={() => setWriting(false)}
        />
      )}
    </Panel>
  );
}
