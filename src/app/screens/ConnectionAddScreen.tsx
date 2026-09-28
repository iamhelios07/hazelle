import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { detect, GENERIC, SIGN_IN_TYPES, type Detection } from '../../connectors/registry';
import type { Connection, Protocol } from '../../connectors/types';
import { loadCatalog } from '../../runtime/catalog';
import { navigate } from '../router';
import { useStore } from '../store';
import { Button, Callout, ChoiceGroup, Intro, NavBar, Screen, Section, Stack, Text, TextField } from '../ui';
import { describeCatalogFailure, describeFailure } from './failure';

const PROTOCOLS: { value: Protocol; label: string }[] = [
  { value: 'chat-completions', label: 'OpenAI 호환' },
  { value: 'anthropic-messages', label: 'Anthropic 호환' },
];

const PROBLEMS = {
  'not-https': 'https 주소만 연결할 수 있어요.',
  local: '내 컴퓨터나 집 안 네트워크의 주소는 서버에서 닿을 수 없어서 연결할 수 없어요.',
};

type Draft = { connection: Connection | null; problem: string | null };

// What the pasted value and the follow-up fields add up to. A URL for a built-in host still needs its
// key, and an unrecognized key still needs its address and protocol.
function draftFrom(detection: Detection | null, key: string, address: string, protocol: Protocol | null): Draft {
  const none = { connection: null, problem: null };
  if (!detection) return none;
  const builtIn = (type: { id: string; label: string }, secret: string) => ({
    connection: { type: type.id, label: type.label, baseUrl: null, protocol: null, secret, starred: [] },
    problem: null,
  });
  const generic = (baseUrl: string, problem: 'not-https' | 'local' | null, secret: string): Draft => {
    if (problem) return { connection: null, problem: PROBLEMS[problem] };
    if (!protocol) return none;
    return { connection: { type: GENERIC, label: new URL(baseUrl).host, baseUrl, protocol, secret, starred: [] }, problem: null };
  };
  switch (detection.kind) {
    case 'key':
      return builtIn(detection.type, detection.secret);
    case 'url':
      return key.trim() ? builtIn(detection.type, key.trim()) : none;
    case 'generic-url':
      return generic(detection.baseUrl, detection.problem, key.trim());
    case 'unknown-key': {
      const place = detect(address);
      if (place?.kind === 'url') return builtIn(place.type, detection.secret);
      if (place?.kind === 'generic-url') return generic(place.baseUrl, place.problem, detection.secret);
      return none;
    }
  }
}

// F5: paste a key or an address; what is recognized fills itself in, and only the rest is asked.
export function ConnectionAddScreen() {
  const store = useStore();
  const [input, setInput] = useState('');
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const detection = detect(input);
  const addressKind = detection?.kind === 'unknown-key' ? detect(address)?.kind : null;
  const draft = draftFrom(detection, key, address, protocol);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const connection = draft.connection;
    if (!connection) return;
    setBusy(true);
    setMessage(null);
    const catalog = await loadCatalog(connection, { fresh: true });
    if (!catalog.ok) {
      setBusy(false);
      setMessage(describeCatalogFailure(catalog.failure));
      return;
    }
    const id = crypto.randomUUID();
    const saved = await store.save<Connection>('connection', id, () => connection);
    setBusy(false);
    if (saved.ok) navigate(`/connections/${id}`, { replace: true });
    else setMessage(describeFailure(saved));
  }

  return (
    <Screen
      top={<NavBar title="연결 추가" onBack={() => navigate('/connections')} />}
      onSubmit={submit}
      actions={
        <>
          <Text size="sm" tone="muted">
            키는 금고 안에 암호화해서 저장해요. 모델을 부를 때만 중계 서버를 지나가고, 서버에 남지 않아요.
          </Text>
          <Button type="submit" busy={busy} disabled={!draft.connection}>
            모델 고르기
          </Button>
        </>
      }
    >
      <Intro title="API 키나 주소를 붙여 넣어 주세요">어디 것인지는 알아서 알아봐요.</Intro>
      <Stack>
        <TextField label="API 키 또는 주소" kind="key" value={input} onChange={setInput} placeholder="sk-… 또는 https://…" />
        {detection?.kind === 'key' && <Callout tone="success">{detection.type.label} 키로 알아봤어요.</Callout>}
        {detection?.kind === 'url' && (
          <>
            <Callout tone="success">{detection.type.label} 주소예요. API 키도 붙여 넣어 주세요.</Callout>
            <TextField label="API 키" kind="key" value={key} onChange={setKey} />
          </>
        )}
        {detection?.kind === 'generic-url' && !detection.problem && (
          <>
            <Text tone="muted">직접 연결할 주소예요. 어떤 방식으로 말하는 곳인가요?</Text>
            <ChoiceGroup label="연결 방식" layout="buttons" options={PROTOCOLS} value={protocol} onChange={setProtocol} />
            <TextField label="API 키" kind="key" value={key} onChange={setKey} hint="키가 필요 없는 곳이면 비워 두세요." />
          </>
        )}
        {detection?.kind === 'unknown-key' && (
          <>
            <Text tone="muted">어디 키인지 모르겠어요. 주소를 알려 주세요.</Text>
            <TextField label="주소" kind="key" value={address} onChange={setAddress} placeholder="https://…" />
            {addressKind === 'generic-url' && (
              <ChoiceGroup label="연결 방식" layout="buttons" options={PROTOCOLS} value={protocol} onChange={setProtocol} />
            )}
          </>
        )}
        {input.trim() && !detection && <Text tone="muted">키나 주소가 아닌 것 같아요. 띄어쓰기 없이 붙여 넣어 주세요.</Text>}
        {draft.problem && <Callout tone="warn">{draft.problem}</Callout>}
      </Stack>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
      <Section title="키 없이 로그인으로">
        {SIGN_IN_TYPES.map((type) => (
          <Button key={type.id} variant="outline" size="md" icon={LogIn} onClick={() => navigate(`/connections/new/${type.id}`)}>
            {type.signIn.site} 로그인으로 {type.label} 연결
          </Button>
        ))}
      </Section>
    </Screen>
  );
}
