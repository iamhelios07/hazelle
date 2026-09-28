import { useState, type FormEvent } from 'react';
import { detect, GENERIC } from '../../connectors/registry';
import type { Connection, Protocol } from '../../connectors/types';
import { navigate } from '../router';
import { useStore } from '../store';
import { Button, Callout, ChoiceGroup, Intro, NavBar, Screen, Stack, Text, TextField } from '../ui';
import { connect } from './connect';

const PROTOCOLS: { value: Protocol; label: string }[] = [
  { value: 'chat-completions', label: 'OpenAI 호환' },
  { value: 'anthropic-messages', label: 'Anthropic 호환' },
];

const PROBLEMS = {
  'not-https': 'https 주소만 연결할 수 있어요.',
  local: '내 컴퓨터나 집 안 네트워크의 주소는 서버에서 닿을 수 없어서 연결할 수 없어요.',
};

// F5 for what the list does not hold. An address the list does know becomes that provider, so it
// gets the provider's balance and costs however it was entered.
export function ConnectionDirectScreen() {
  const store = useStore();
  const [address, setAddress] = useState(() => new URLSearchParams(location.search).get('address') ?? '');
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const place = detect(address);
  const secret = key.trim();
  let draft: Connection | null = null;
  if (place?.kind === 'url' && secret) {
    draft = { type: place.type.id, label: place.type.label, baseUrl: null, protocol: null, secret, starred: [] };
  } else if (place?.kind === 'generic-url' && !place.problem && protocol) {
    draft = { type: GENERIC, label: new URL(place.baseUrl).host, baseUrl: place.baseUrl, protocol, secret, starred: [] };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    const failure = await connect(store, draft);
    setBusy(false);
    setMessage(failure);
  }

  return (
    <Screen
      top={<NavBar title="직접 연결" onBack={() => navigate('/connections/new')} />}
      onSubmit={submit}
      actions={
        <Button type="submit" busy={busy} disabled={!draft}>
          모델 고르기
        </Button>
      }
    >
      <Intro title="목록에 없는 곳 연결">OpenAI 호환이나 Anthropic 호환으로 말하는 곳이면 연결할 수 있어요. 잔액과 비용은 알 수 없어요.</Intro>
      <Stack>
        <TextField label="주소" kind="key" value={address} onChange={setAddress} placeholder="https://…/v1" />
        {place?.kind === 'url' && <Callout tone="success">{place.type.label} 주소예요. {place.type.label} 연결로 만들어요.</Callout>}
        {place?.kind === 'generic-url' && place.problem && <Callout tone="warn">{PROBLEMS[place.problem]}</Callout>}
        {place?.kind === 'generic-url' && !place.problem && (
          <ChoiceGroup label="연결 방식" layout="buttons" options={PROTOCOLS} value={protocol} onChange={setProtocol} />
        )}
        {address.trim() && place?.kind !== 'url' && place?.kind !== 'generic-url' && (
          <Text tone="muted">https:// 로 시작하는 주소를 넣어 주세요.</Text>
        )}
        {(place?.kind === 'url' || (place?.kind === 'generic-url' && !place.problem)) && (
          <TextField
            label="API 키"
            kind="key"
            value={key}
            onChange={setKey}
            hint={place.kind === 'generic-url' ? '키가 필요 없는 곳이면 비워 두세요.' : undefined}
          />
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
