import { Send } from 'lucide-react';
import { useState } from 'react';
import { sendNotice, setService, type Service } from '../../runtime/admin';
import { describeFailure } from '../common/failure';
import { sizeText } from '../common/size';
import { useAttempt } from '../common/useAttempt';
import { NOTICES } from '../common/words';
import { useToast } from '../toast';
import { Button, Callout, NumberInput, Section, SettingGroup, SettingRow } from '../ui';
import { CAP_ERROR, capText, typedCap, typedCount } from './bytes';
import { NoticeDialog } from './NoticeDialog';

// The operator raises the cap in steps, so each cap sits with the count it bounds.
export function ServiceSection({ service, onSaved }: { service: Service; onSaved: () => void }) {
  // null: not typed in, so the field shows the server's value.
  const [seats, setSeats] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  const [fileCap, setFileCap] = useState<string | null>(null);
  const { busy, failure, run } = useAttempt();
  const toast = useToast();
  const [writing, setWriting] = useState(false);
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
          label="계정당 글 한도"
          help="그림을 뺀, 한 계정이 저장한 내용의 크기예요. 비우면 한도가 없어요. 계정 목록에서 계정마다 따로 정할 수 있어요."
          error={accountBytesCap === undefined ? CAP_ERROR : undefined}
          control={<NumberInput label="계정당 글 한도" unit="MB" placeholder="없음" value={cap ?? capText(service.accountBytesCap)} invalid={accountBytesCap === undefined} onChange={setCap} />}
        />
        <SettingRow
          label="계정당 그림 한도"
          help="한 계정이 올린 그림의 크기예요. 그림은 지워도 줄지 않아요. 비우면 한도가 없어요. 계정 목록에서 계정마다 따로 정할 수 있어요."
          sub={`저장된 그림 합계 ${sizeText(service.fileBytes)}`}
          error={accountFileBytesCap === undefined ? CAP_ERROR : undefined}
          control={<NumberInput label="계정당 그림 한도" unit="MB" placeholder="없음" value={fileCap ?? capText(service.accountFileBytesCap)} invalid={accountFileBytesCap === undefined} onChange={setFileCap} />}
        />
        <SettingRow
          label={`모두에게 ${NOTICES.send}`}
          help="지금 있는 계정이 모두 받아요. 나중에 가입한 계정에는 보이지 않아요."
          control={
            <Button variant="secondary" size="sm" icon={Send} onClick={() => setWriting(true)}>
              보내기
            </Button>
          }
        />
      </SettingGroup>
      {writing && (
        <NoticeDialog
          title={`모두에게 ${NOTICES.send}`}
          label="보낼 내용"
          confirm={{ label: '보내기', icon: Send }}
          send={(text) => sendNotice(null, text)}
          onSent={() => {
            setWriting(false);
            toast.show('모두에게 보냈어요.');
            onSaved();
          }}
          onClose={() => setWriting(false)}
        />
      )}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Section>
  );
}
