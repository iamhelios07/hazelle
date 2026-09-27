import { DoorOpen, Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Callout, Card, Columns, Intro, Screen, Stack, Steps, Text, TextField, Brand } from '../ui';

const MIN_LENGTH = 8;

type Props = {
  // setup: F1 step 2. reset: after opening the vault with the recovery key, a new passphrase is required.
  mode: 'setup' | 'reset';
  // The login password, when this page still knows it. The vault passphrase must differ, or the server
  // could derive the vault key from a password it has seen.
  loginPassword: string | null;
  onDone: (passphrase: string) => Promise<string | null>;
};

export function VaultPassphraseScreen({ mode, loginPassword, onDone }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = mode === 'setup';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ([...passphrase].length < MIN_LENGTH) return setMessage(`금고 비밀번호는 ${MIN_LENGTH}자 이상이어야 해요.`);
    if (passphrase !== again) return setMessage('두 비밀번호가 달라요.');
    if (loginPassword !== null && passphrase.normalize('NFC') === loginPassword.normalize('NFC')) {
      return setMessage('로그인 비밀번호와 다른 비밀번호를 써 주세요.');
    }
    setBusy(true);
    setMessage(null);
    const failure = await onDone(passphrase);
    setBusy(false);
    setMessage(failure);
  }

  return (
    <Screen
      top={
        <>
          <Brand />
          {setup && (
            <Text size="sm" tone="muted">
              2 / 3
            </Text>
          )}
        </>
      }
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy}>
          {setup ? '다음' : '저장'}
        </Button>
      }
    >
      {setup && <Steps current={2} total={3} />}
      <Intro title={setup ? '금고 비밀번호 정하기' : '새 금고 비밀번호 정하기'}>
        {setup
          ? '채팅, 캐릭터, API 키는 이 비밀번호로 잠근 뒤에 서버로 올라가요. 서버는 열어 볼 수 없어요.'
          : '복구 키로 금고를 열었어요. 앞으로 쓸 금고 비밀번호를 새로 정해 주세요.'}
      </Intro>
      {setup && (
        <Columns>
          <Card icon={DoorOpen} title="로그인 비밀번호">
            계정 문을 여는 열쇠. 서버가 확인하고, 잊으면 다시 정할 수 있어요.
          </Card>
          <Card tone="accent" icon={Lock} title="금고 비밀번호">
            데이터를 여는 열쇠. 기기 안에서만 쓰이고 서버는 몰라요.
          </Card>
        </Columns>
      )}
      <Stack>
        <TextField label="금고 비밀번호" kind="new-password" value={passphrase} onChange={setPassphrase} placeholder="로그인 비밀번호와 다르게" />
        <TextField label="한 번 더" kind="new-password" value={again} onChange={setAgain} placeholder="같은 비밀번호" />
      </Stack>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
    </Screen>
  );
}
