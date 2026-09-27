import { useState } from 'react';
import { api } from '../api';
import { Brand, Button, Callout, Intro, Screen } from '../ui';
import { describeFailure } from './failure';

// Stands in for the home screen until the vault slice adds F1 steps 2–4 (design §2).
export function SignedInScreen({ username, onSignedOut }: { username: string; onSignedOut: () => void }) {
  const [message, setMessage] = useState<string | null>(null);

  async function logout() {
    const result = await api('POST', 'logout');
    if (result.ok) onSignedOut();
    else setMessage(describeFailure(result));
  }

  return (
    <Screen
      top={<Brand />}
      actions={
        <Button variant="secondary" onClick={logout}>
          로그아웃
        </Button>
      }
    >
      <Intro title={username}>로그인되어 있어요. 금고 만들기와 채팅은 아직 준비 중이에요.</Intro>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
    </Screen>
  );
}
