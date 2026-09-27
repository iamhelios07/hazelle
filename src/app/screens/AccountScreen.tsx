import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Brand, Button, Callout, Intro, Screen, Stack, Steps, Text, TextField } from '../ui';
import { describeFailure } from './failure';

// onSignedIn receives the login password so the vault step can refuse the same text as a passphrase.
export function AccountScreen({ mode, onSignedIn }: { mode: 'signup' | 'login'; onSignedIn: (password: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (signup && password !== again) {
      setMessage('두 비밀번호가 달라요.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await api('POST', mode, { username: username.trim(), password });
    setBusy(false);
    if (result.ok) onSignedIn(password);
    else setMessage(describeFailure(result));
  }

  return (
    <Screen
      top={
        <>
          <Brand />
          {signup && (
            <Text size="sm" tone="muted">
              1 / 3
            </Text>
          )}
        </>
      }
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy}>
          {signup ? '계정 만들기' : '로그인'}
        </Button>
      }
    >
      {signup && <Steps current={1} total={3} />}
      <Intro title={signup ? '계정 만들기' : '로그인'}>
        {signup && '어느 기기에서든 같은 채팅을 이어가기 위한 로그인이에요.'}
      </Intro>
      <Stack>
        <TextField label="아이디" kind="username" value={username} onChange={setUsername} />
        <TextField
          label={signup ? '로그인 비밀번호' : '비밀번호'}
          kind={signup ? 'new-password' : 'current-password'}
          value={password}
          onChange={setPassword}
          placeholder={signup ? '8자 이상' : undefined}
        />
        {signup && <TextField label="한 번 더" kind="new-password" value={again} onChange={setAgain} placeholder="같은 비밀번호" />}
      </Stack>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
    </Screen>
  );
}
