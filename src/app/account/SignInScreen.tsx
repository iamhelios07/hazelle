import { FileText, LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAttempt } from '../common/useAttempt';
import { Brand, Button, Callout, FileButton, IconButton, Intro, Screen, Stack, TextField } from '../ui';

type Method = 'password' | 'recovery';

type Props = {
  // The account whose vault is locked on this device, or null when signed out.
  account: string | null;
  onSubmit: (username: string, method: Method, secret: string) => Promise<string | null>;
  onLogout?: () => void;
};

// Signing in and unlocking are the same act: the password (or the recovery key) opens the vault.
export function SignInScreen({ account, onSubmit, onLogout }: Props) {
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
        </>
      }
    >
      <Intro title={recovery ? `복구 키로 ${verb}` : account ? '잠금 풀기' : '로그인'}>
        {recovery
          ? '내려받아 둔 복구 키 파일을 고르거나, 키를 직접 넣어 주세요. 열리면 새 비밀번호를 정해요.'
          : account && `${account} 계정이 이 기기에서 잠겨 있어요. 비밀번호를 넣어 주세요.`}
      </Intro>
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
    </Screen>
  );
}
