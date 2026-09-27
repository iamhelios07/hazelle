import { FileText, LogOut } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Brand, Button, Callout, FileButton, IconButton, Intro, Screen, Stack, TextField } from '../ui';

type Props = {
  onPassphrase: (passphrase: string) => Promise<boolean>;
  onRecoveryKey: (text: string) => Promise<boolean>;
  onLogout: () => void;
};

export function UnlockScreen({ onPassphrase, onRecoveryKey, onLogout }: Props) {
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recovery = mode === 'recovery';

  async function attempt(text: string) {
    setBusy(true);
    setMessage(null);
    const opened = recovery ? await onRecoveryKey(text) : await onPassphrase(text);
    setBusy(false);
    if (!opened) setMessage(recovery ? '복구 키가 맞지 않아요.' : '금고 비밀번호가 맞지 않아요.');
  }

  function switchMode() {
    setMode(recovery ? 'passphrase' : 'recovery');
    setValue('');
    setMessage(null);
  }

  return (
    <Screen
      top={
        <>
          <Brand />
          <IconButton icon={LogOut} label="로그아웃" onClick={onLogout} />
        </>
      }
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void attempt(value);
      }}
      actions={
        <>
          <Button type="submit" busy={busy}>
            열기
          </Button>
          <Button variant="ghost" onClick={switchMode}>
            {recovery ? '금고 비밀번호로 열기' : '복구 키로 열기'}
          </Button>
        </>
      }
    >
      <Intro title={recovery ? '복구 키로 열기' : '금고 열기'}>
        {recovery
          ? '내려받아 둔 복구 키 파일을 고르거나, 키를 직접 넣어 주세요.'
          : '이 기기에서는 금고가 잠겨 있어요. 금고 비밀번호를 넣어 주세요.'}
      </Intro>
      <Stack>
        {recovery ? (
          <>
            <FileButton accept=".txt,text/plain" icon={FileText} onFile={(file) => void file.text().then(attempt)}>
              파일에서 불러오기
            </FileButton>
            <TextField label="복구 키" kind="code" value={value} onChange={setValue} placeholder="XXXX-XXXX-XXXX-…" />
          </>
        ) : (
          <TextField label="금고 비밀번호" kind="current-password" value={value} onChange={setValue} />
        )}
      </Stack>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
    </Screen>
  );
}
