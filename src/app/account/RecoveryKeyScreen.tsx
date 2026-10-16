import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { ACTS, exportOf } from '../common/acts';
import { useAttempt } from '../common/useAttempt';
import { Button, Callout, Checkbox, CodeCard, IconButton, Intro, Link, Screen, Steps, Text } from '../ui';
import { download } from '../common/download';
import { PRIVACY, TERMS } from '../common/legal';

const FILENAME = 'hazelle-recovery.txt';

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
      '헤이젤 복구 키',
      `계정: ${username}`,
      '',
      recoveryKey,
      '',
      '비밀번호를 잊었을 때 로그인 화면의 \'복구 키로 로그인\'에서 이 파일이나 위의 키를 입력해 주세요.',
      '비밀번호와 이 키를 모두 잃어버리면, 백업 파일이 없는 한 누구도 데이터를 복원할 수 없어요.',
      `생성일: ${created}`,
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
            시작하기를 누르면 아래 두 문서에 동의하는 것으로 봐요.
          </Text>
          <Text variant="note" align="center">
            <Link href={TERMS.path}>{TERMS.title}</Link> · <Link href={PRIVACY.path}>{PRIVACY.title}</Link>
          </Text>
          <Text variant="note" align="center">
            이 단계는 건너뛸 수 없어요.
          </Text>
        </>
      }
    >
      <Steps current={2} total={2} />
      <Intro title="복구 키 저장">비밀번호를 잊어버렸을 때 필요해요.</Intro>
      <Callout tone="warn">비밀번호와 복구 키를 모두 잃어버리면 누구도 데이터를 복원할 수 없어요.</Callout>
      <CodeCard label="복구 키" code={recoveryKey} />
      {downloaded ? (
        <Callout tone="success">내보냈어요 · {FILENAME}</Callout>
      ) : (
        <Button variant="secondary" icon={ACTS.export.icon} onClick={save}>
          {exportOf('복구 키 파일')}
        </Button>
      )}
      <Checkbox label="안전한 곳에 저장했어요" checked={saved} onChange={setSaved} />
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Screen>
  );
}
