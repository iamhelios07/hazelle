import { Send } from 'lucide-react';
import { useState } from 'react';
import { MAX_REPORT_LENGTH } from '../../contracts/admin';
import { sendReport } from '../../runtime/account';
import { diagnosticReport } from '../../runtime/diagnostics';
import { describeFailure } from '../common/failure';
import { BUILT_VERSION } from '../common/release';
import { count } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { useToast } from '../toast';
import { Button, Callout, Checkbox, Dialog, Stack, Text, TextField } from '../ui';

export const REPORT = '운영자에게 알리기';

export function ReportButton({ onSent }: { onSent: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon={Send} onClick={() => setOpen(true)}>
        {REPORT}
      </Button>
      {open && <ReportDialog onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  );
}

function ReportDialog({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  // On by default: an error report is rarely answerable without it, and it holds no chat text or key.
  const [withDevice, setWithDevice] = useState(true);
  const { busy, failure, run } = useAttempt();
  const length = text.trim().length;
  const over = length > MAX_REPORT_LENGTH;

  const send = () =>
    run(async () => {
      const sent = await sendReport(text, withDevice ? await diagnosticReport(BUILT_VERSION) : null);
      if (!sent.ok) return describeFailure(sent);
      toast.show('운영자에게 보냈어요.');
      onSent();
      onClose();
      return null;
    });

  return (
    <Dialog
      title={REPORT}
      note="이 내용은 종단 간 암호화되지 않고, 운영자가 아이디와 함께 확인해요."
      onClose={onClose}
      onSubmit={() => void send()}
      actions={
        <Button type="submit" icon={Send} busy={busy} disabled={length === 0 || over}>
          보내기
        </Button>
      }
    >
      <TextField
        label="알릴 내용"
        lines={5}
        value={text}
        onChange={setText}
        placeholder="예: 이미지 하나가 열리지 않아요."
        hint={`${count(length)} / ${count(MAX_REPORT_LENGTH)}자`}
        error={over ? `${count(MAX_REPORT_LENGTH)}자까지 보낼 수 있어요.` : undefined}
      />
      <Stack gap="related">
        <Checkbox label="기기 정보와 최근 오류도 보내기" checked={withDevice} onChange={setWithDevice} />
        <Text variant="note">앱 정보의 문제 진단과 같은 내용이에요. 채팅 내용이나 API 키는 담기지 않아요.</Text>
      </Stack>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Dialog>
  );
}
