import { ChevronLeft, Download } from 'lucide-react';
import { useState } from 'react';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, Checkbox, CodeCard, IconButton, Intro, Screen, Steps, Text } from '../ui';
import { download } from '../common/download';

const FILENAME = 'risu-alpha-recovery.txt';

type Props = {
  username: string;
  recoveryKey: string;
  onBack: () => void;
  // The account and its vault are created only here, after the download, so neither exists without a saved recovery key.
  onStart: () => Promise<string | null>;
};

export function RecoveryKeyScreen({ username, recoveryKey, onBack, onStart }: Props) {
  const [downloaded, setDownloaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const { busy, failure, run } = useAttempt();

  function save() {
    const created = new Date().toISOString().slice(0, 10);
    const text = [
      'risu-alpha 복구 키',
      `계정: ${username}`,
      '',
      recoveryKey,
      '',
      '비밀번호를 잊었을 때 로그인 화면의 "복구 키로 로그인"에 이 파일이나 위의 키를 넣으세요.',
      '비밀번호와 이 키를 둘 다 잃으면, 받아 둔 백업 파일이 없는 한 누구도 데이터를 되살릴 수 없습니다.',
      `만든 날: ${created}`,
      '',
    ].join('\n');
    download(FILENAME, new Blob([text], { type: 'text/plain;charset=utf-8' }));
    setDownloaded(true);
  }

  return (
    <Screen
      top={
        <>
          <IconButton icon={ChevronLeft} label="이전" onClick={onBack} />
          <Text variant="note">
            2 / 2
          </Text>
        </>
      }
      actions={
        <>
          <Button disabled={!downloaded || !saved} busy={busy} onClick={() => void run(onStart)}>
            시작하기
          </Button>
          <Text variant="note" align="center">
            이 단계는 건너뛸 수 없어요.
          </Text>
        </>
      }
    >
      <Steps current={2} total={2} />
      <Intro title="복구 키 저장">비밀번호를 잊었을 때 쓰는 하나뿐인 예비 열쇠예요.</Intro>
      <Callout tone="warn">비밀번호와 복구 키를 둘 다 잃으면 데이터는 누구도 되살릴 수 없어요. 저희도요.</Callout>
      <CodeCard label="복구 키" code={recoveryKey} />
      {downloaded ? (
        <Callout tone="success">내려받음 · {FILENAME}</Callout>
      ) : (
        <Button variant="outline" icon={Download} onClick={save}>
          복구 키 파일 내려받기
        </Button>
      )}
      <Checkbox label="안전한 곳에 따로 저장했어요" checked={saved} onChange={setSaved} />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Screen>
  );
}
