import { LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { Method } from '../../vault/keys';
import { ACTS } from '../common/acts';
import { useCredential } from '../common/useCredential';
import { LegalNotice } from '../common/LegalNotice';
import { useAttempt } from '../common/useAttempt';
import { Brand, Button, Callout, FileButton, IconButton, Intro, Screen, Stack, Text, TextField } from '../ui';

type Props = {
  // The account whose vault is locked on this device, or null when signed out.
  account: string | null;
  notice?: string | null;
  // Signed out: the way to make an account, or full while the operator's cap of accounts is reached.
  signup?: (() => void) | 'full';
  onSubmit: (username: string, method: Method, secret: string) => Promise<string | null>;
  onLogout?: () => void;
};

// Signing in and unlocking are the same act: the password (or the recovery key) opens the vault.
export function SignInScreen({ account, notice, signup, onSubmit, onLogout }: Props) {
  const [username, setUsername] = useState('');
  const { busy, failure, run, setFailure } = useAttempt();
  const credential = useCredential(setFailure);
  const { method, secret, recovery } = credential;
  const verb = account ? '잠금 해제' : '로그인';

  const attempt = (text: string) => run(() => onSubmit(account ?? username, method, text));

  return (
    <Screen
      top={
        <>
          <Brand />
          {onLogout && <IconButton icon={LogOut} label="로그아웃" onClick={onLogout} />}
        </>
      }
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void attempt(secret);
      }}
      actions={
        <>
          <Button type="submit" busy={busy}>
            {verb}
          </Button>
          <Button variant="ghost" onClick={credential.switchMethod}>
            {`${credential.alternate}로 ${verb}`}
          </Button>
          {typeof signup === 'function' && (
            <Button variant="ghost" onClick={signup}>
              계정 만들기
            </Button>
          )}
        </>
      }
    >
      <Intro title={recovery ? `복구 키로 ${verb}` : verb}>
        {recovery
          ? '복구 키 파일을 선택하거나 키를 입력해 주세요.'
          : account && `${account} 계정이 이 기기에서 잠겨 있어요.`}
      </Intro>
      {notice && <Text variant="note">{notice}</Text>}
      {signup === 'full' && <Text variant="note">가입 정원이 다 차서 새 계정을 만들 수 없어요.</Text>}
      <Stack>
        {!account && <TextField label="아이디" kind="username" value={username} onChange={setUsername} />}
        {recovery && (
          <FileButton accept=".txt,text/plain" icon={ACTS.import.icon} onFiles={([file]) => void file!.text().then(attempt)}>
            파일에서 {ACTS.import.label}
          </FileButton>
        )}
        <TextField {...credential.field} />
      </Stack>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
      <LegalNotice />
    </Screen>
  );
}
