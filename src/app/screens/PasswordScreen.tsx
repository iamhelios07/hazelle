import { useState, type FormEvent } from 'react';
import { Brand, Button, Callout, Intro, Screen, Stack, Steps, Text, TextField } from '../ui';

const MIN_LENGTH = 8;

type Props = {
  // signup: F1 step 1. reset: after the recovery key opened the vault, a new password is required.
  mode: 'signup' | 'reset';
  username: string;
  onDone: (username: string, password: string) => Promise<string | null>;
};

// The server never sees the password, so its rules are checked here and nowhere else.
export function PasswordScreen({ mode, username: initialUsername, onDone }: Props) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if ([...password].length < MIN_LENGTH) return setMessage(`비밀번호는 ${MIN_LENGTH}자 이상이어야 해요.`);
    if (password !== again) return setMessage('두 비밀번호가 달라요.');
    setBusy(true);
    setMessage(null);
    const failure = await onDone(username, password);
    setBusy(false);
    setMessage(failure);
  }

  return (
    <Screen
      top={
        <>
          <Brand />
          {signup && (
            <Text size="sm" tone="muted">
              1 / 2
            </Text>
          )}
        </>
      }
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy}>
          {signup ? '다음' : '저장'}
        </Button>
      }
    >
      {signup && <Steps current={1} total={2} />}
      <Intro title={signup ? '계정 만들기' : '새 비밀번호 정하기'}>
        {signup
          ? '비밀번호 하나로 로그인하고 금고도 열어요. 서버는 이 비밀번호를 받지 않아서 채팅, 캐릭터, API 키를 열어 볼 수 없어요.'
          : '복구 키로 열었어요. 앞으로 쓸 비밀번호를 새로 정해 주세요.'}
      </Intro>
      <Stack>
        {signup && <TextField label="아이디" kind="username" value={username} onChange={setUsername} />}
        <TextField label="비밀번호" kind="new-password" value={password} onChange={setPassword} placeholder="8자 이상" />
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
