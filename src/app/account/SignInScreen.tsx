import { FileText, LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { LegalNotice } from '../common/LegalNotice';
import { useAttempt } from '../common/useAttempt';
import { Brand, Button, Callout, FileButton, IconButton, Intro, Screen, Stack, Text, TextField } from '../ui';

type Method = 'password' | 'recovery';

type Props = {
  // The account whose vault is locked on this device, or null when signed out.
  account: string | null;
  // Why this shows instead of what was open, such as another tab's sign-in.
  notice?: string | null;
  // Signed out: the way to make an account, or full while the operator's cap of accounts is reached.
  signup?: (() => void) | 'full';
  onSubmit: (username: string, method: Method, secret: string) => Promise<string | null>;
  onLogout?: () => void;
};

// Signing in and unlocking are the same act: the password (or the recovery key) opens the vault.
export function SignInScreen({ account, notice, signup, onSubmit, onLogout }: Props) {
  const [method, setMethod] = useState<Method>('password');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const { busy, failure, run, setFailure } = useAttempt();
  const recovery = method === 'recovery';
  const verb = account ? '열기' : '로그인';

  const attempt = (text: string) => run(() => onSubmit(account ?? username, method, text));

  function switchMethod() {
    setMethod(recovery ? 'password' : 'recovery');
    setSecret('');
    setFailure(null);
  }

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
          <Button variant="ghost" onClick={switchMethod}>
            {recovery ? `비밀번호로 ${verb}` : `복구 키로 ${verb}`}
          </Button>
          {typeof signup === 'function' && (
            <Button variant="ghost" onClick={signup}>
              계정 만들기
            </Button>
          )}
        </>
      }
    >
      <Intro title={recovery ? `복구 키로 ${verb}` : account ? '잠금 풀기' : '로그인'}>
        {recovery
          ? '내려받아 둔 복구 키 파일을 고르거나, 키를 직접 넣어 주세요. 열리면 새 비밀번호를 정해요.'
          : account && `${account} 계정이 이 기기에서 잠겨 있어요. 비밀번호를 넣어 주세요.`}
      </Intro>
      {notice && <Text variant="note">{notice}</Text>}
      {signup === 'full' && <Text variant="note">지금은 자리가 다 차서 새 계정을 만들 수 없어요. 자리가 늘면 다시 열려요.</Text>}
      <Stack>
        {!account && <TextField label="아이디" kind="username" value={username} onChange={setUsername} />}
        {recovery ? (
          <>
            <FileButton accept=".txt,text/plain" icon={FileText} onFile={(file) => void file.text().then(attempt)}>
              파일에서 불러오기
            </FileButton>
            <TextField label="복구 키" kind="code" value={secret} onChange={setSecret} placeholder="XXXX-XXXX-XXXX-…" />
          </>
        ) : (
          <TextField label="비밀번호" kind="current-password" value={secret} onChange={setSecret} />
        )}
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
