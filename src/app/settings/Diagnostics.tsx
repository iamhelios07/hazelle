import { Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { diagnosticReport } from '../../runtime/diagnostics';
import { ACTS } from '../common/acts';
import { BUILT_VERSION } from '../common/release';
import { useCopy } from '../common/useCopy';
import { Button, Row, SettingRow, Stack, TextField } from '../ui';

// 앱 정보's 문제 진단: run, read, then copy in a press of its own, since the check outlasts the press's activation.
export function Diagnostics() {
  const copy = useCopy();
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    void diagnosticReport(BUILT_VERSION).then(setReport).finally(() => setBusy(false));
  };
  return (
    <>
      <SettingRow
        label="문제 진단"
        help="오류가 나면 눌러서 나온 내용을 복사해 운영자에게 그대로 붙여넣어 주세요. 기기와 브라우저 정보, 이 탭에서 난 최근 오류만 담기고 채팅 내용이나 API 키는 담기지 않아요."
        control={
          <Button variant="secondary" size="sm" icon={Stethoscope} busy={busy} onClick={run}>
            진단하기
          </Button>
        }
      />
      {report !== null && (
        <Stack gap="related">
          <TextField label="진단 정보" lines={10} value={report} onChange={() => {}} readOnly />
          <Row kind="actions">
            <Button variant="secondary" size="sm" icon={ACTS.copy.icon} onClick={() => copy(report)}>
              {ACTS.copy.label}
            </Button>
          </Row>
        </Stack>
      )}
    </>
  );
}
