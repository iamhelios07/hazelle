import { useState, type FormEvent } from 'react';
import { detect } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { useAttempt } from '../common/useAttempt';
import { useSession } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, Intro, Link, NavBar, Screen, Stack, Text, TextField } from '../ui';
import { connect } from './connect';

export function ConnectionKeyScreen({ type, back }: { type: ConnectionType; back: Back }) {
  const session = useSession();
  const [key, setKey] = useState('');
  const { busy, failure, run } = useAttempt();
  const secret = key.trim();
  const other = detect(secret);
  const elsewhere = other?.kind === 'key' && other.type !== type ? other.type : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!secret) return;
    await run(() => connect(session, { type: type.id, label: type.label, baseUrl: null, protocol: null, secret, starred: [] }));
  }

  return (
    <Screen
      top={<NavBar title={`${type.label} 연결`} {...backBar(back)} />}
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
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Screen>
  );
}
