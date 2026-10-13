import { useState, type FormEvent } from 'react';
import { detect } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { providerConnection } from '../../runtime/connections';
import { ACTS, importOf, newOf } from '../common/acts';
import { useAttempt } from '../common/useAttempt';
import { useSession } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, FileButton, Intro, Link, NavBar, Screen, Stack, TextField } from '../ui';
import { connect } from './connect';

export function ConnectionKeyScreen({ type, back }: { type: ConnectionType; back: Back }) {
  const session = useSession();
  const [key, setKey] = useState('');
  const { busy, failure, run } = useAttempt();
  const form = type.keyForm;
  const secret = key.trim();
  const other = detect(secret);
  const elsewhere = other?.kind === 'key' && other.type !== type ? other.type : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!secret) return;
    await run((signal) => connect(session, providerConnection(type, secret), signal));
  }

  return (
    <Screen
      top={<NavBar title={`${type.label} 연결`} {...backBar(back)} />}
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy} disabled={!secret}>
          모델 선택
        </Button>
      }
    >
      <Intro title={type.label}>{type.description}</Intro>
      <Stack>
        <TextField
          label={form?.label ?? 'API 키'}
          kind="key"
          lines={form?.lines}
          placeholder={form?.placeholder}
          value={key}
          onChange={setKey}
          help="키는 암호화해서 저장하고, 서버에 남기지 않아요."
          action={
            form && (
              <FileButton accept={form.accept} size="sm" icon={ACTS.import.icon} onFiles={([file]) => void file!.text().then(setKey)}>
                {importOf('파일')}
              </FileButton>
            )
          }
        />
        {type.keyPage && <Link href={type.keyPage}>{new URL(type.keyPage).host}에서 키 만들기</Link>}
        {elsewhere && <Callout tone="warn">{elsewhere.label} 키 같아요. {newOf('연결')}에서 다시 선택해 주세요.</Callout>}
      </Stack>
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
    </Screen>
  );
}
