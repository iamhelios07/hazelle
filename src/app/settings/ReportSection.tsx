import { Send } from 'lucide-react';
import { useState } from 'react';
import { MAX_REPORT_LENGTH } from '../../contracts/admin';
import { sendReport } from '../../runtime/account';
import { describeFailure } from '../common/failure';
import { count } from '../common/typedNumber';
import { useAttempt } from '../common/useAttempt';
import { useToast } from '../toast';
import { Button, Callout, Panel, Row, Stack, TextField } from '../ui';

export function ReportSection() {
  const toast = useToast();
  const [text, setText] = useState('');
  const { busy, failure, run } = useAttempt();
  const length = text.trim().length;
  const over = length > MAX_REPORT_LENGTH;

  const send = () =>
    run(async () => {
      const sent = await sendReport(text);
      if (!sent.ok) return describeFailure(sent);
      setText('');
      toast.show('운영자에게 보냈어요.');
      return null;
    });

  return (
    <Panel title="운영자에게 알리기" help="이 내용은 종단 간 암호화되지 않고, 운영자가 아이디와 함께 확인해요.">
      <Stack gap="related">
        <TextField
          label="알릴 내용"
          lines={5}
          value={text}
          onChange={setText}
          placeholder="예: 이미지 하나가 열리지 않아요."
          hint={`${count(length)} / ${count(MAX_REPORT_LENGTH)}자`}
          error={over ? `${count(MAX_REPORT_LENGTH)}자까지 보낼 수 있어요.` : undefined}
        />
        <Row kind="actions">
          <Button variant="secondary" size="sm" icon={Send} busy={busy} disabled={length === 0 || over} onClick={() => void send()}>
            보내기
          </Button>
        </Row>
        {failure && (
          <Callout tone="warn" alert>
            {failure}
          </Callout>
        )}
      </Stack>
    </Panel>
  );
}
