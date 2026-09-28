import { useState, type FormEvent } from 'react';
import { detect } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { navigate } from '../router';
import { useSession } from '../session';
import { Button, Callout, Intro, Link, NavBar, Screen, Stack, Text, TextField } from '../ui';
import { connect } from './connect';

// F5 for a provider picked from the list: its address is known, so only the key is asked.
export function ConnectionKeyScreen({ type }: { type: ConnectionType }) {
  const session = useSession();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const secret = key.trim();
  const other = detect(secret);
  const elsewhere = other?.kind === 'key' && other.type !== type ? other.type : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!secret) return;
    setBusy(true);
    setMessage(null);
    const failure = await connect(session, { type: type.id, label: type.label, baseUrl: null, protocol: null, secret, starred: [] });
    setBusy(false);
    setMessage(failure);
  }

  return (
    <Screen
      top={<NavBar title={`${type.label} 연결`} onBack={() => navigate('/connections/new')} />}
      onSubmit={submit}
      actions={
        <>
          <Text size="sm" tone="muted">
            키는 금고 안에 암호화해서 저장해요. 모델을 부를 때만 중계 서버를 지나가고, 서버에 남지 않아요.
          </Text>
          <Button type="submit" busy={busy} disabled={!secret}>
            모델 고르기
          </Button>
        </>
      }
    >
      <Intro title={type.label}>{type.description}</Intro>
      <Stack>
        <TextField label="API 키" kind="key" value={key} onChange={setKey} />
        {type.keyPage && <Link href={type.keyPage}>{new URL(type.keyPage).host}에서 키 만들기</Link>}
        {elsewhere && <Callout tone="warn">{elsewhere.label} 키 같아요. 연결 추가 목록에서 다시 골라 주세요.</Callout>}
      </Stack>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
    </Screen>
  );
}
