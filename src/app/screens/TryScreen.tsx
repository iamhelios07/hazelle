import { Send, Square } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { resolveRole } from '../../connectors/assignment';
import type { Cost } from '../../connectors/types';
import { settleCost } from '../../runtime/cost';
import { generate, type Reply as ReplyFacts } from '../../runtime/generate';
import { navigate } from '../router';
import { useConnections, useSettings } from '../store';
import { Button, Callout, Facts, NavBar, Reply, Screen, Stack, Tag, Text, TextField } from '../ui';
import { CUT, describeReplyError } from './failure';
import { usd } from './money';

const UNKNOWN = '알 수 없음';

const seconds = (ms: number | null) => (ms === null ? UNKNOWN : `${(ms / 1000).toFixed(1)}초`);
const tokens = (count: number | null) => (count === null ? UNKNOWN : count.toLocaleString('ko-KR'));
const cost = (value: Cost | 'pending' | null) =>
  value === null
    ? UNKNOWN
    : value === 'pending'
      ? '확인 중…'
      : value.unit === 'usd'
      ? usd(value.amount)
      : `${value.amount} 크레딧`;

// One message to the 본 대화 model and its streamed answer, with the receipt's facts: a way to see
// that a connection works end to end before any chat exists.
export function TryScreen() {
  const settings = useSettings();
  const connections = useConnections();
  const [prompt, setPrompt] = useState('안녕! 한두 문장으로 자기소개해 줘.');
  const [text, setText] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [reply, setReply] = useState<ReplyFacts | null>(null);
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lookup = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
      lookup.current?.abort();
    },
    [],
  );

  const main = resolveRole('main', [settings.models]);
  const connection = main && connections.find((entry) => entry.id === main.connection);
  const model = main && connection?.value.starred.find((entry) => entry.id === main.model);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (running) {
      controller.current?.abort();
      return;
    }
    if (!connection || !model || !prompt.trim()) return;
    // A cost lookup for the previous reply may still be waiting.
    lookup.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setText('');
    setReasoning('');
    setReply(null);
    setRunning(true);
    const result = await generate({
      connection: connection.value,
      model,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: null,
      signal: abort.signal,
      onText: (phase, chunk) => (phase === 'text' ? setText((all) => all + chunk) : setReasoning((all) => all + chunk)),
    });
    setRunning(false);
    setReply(result);
    // A stopped reply may still be billed, so its cost is looked up under a signal of its own.
    if (result.cost !== 'pending' || !result.replyId) return;
    const settling = new AbortController();
    lookup.current = settling;
    const settled = await settleCost(connection.value, result.replyId, settling.signal);
    if (!settling.signal.aborted) setReply({ ...result, cost: settled.ok ? settled.cost : null });
  }

  if (!connection || !model) {
    return (
      <Screen
        top={<NavBar title="시험해 보기" onBack={() => navigate('/connections')} />}
        actions={<Button onClick={() => navigate('/connections')}>연결에서 고르기</Button>}
      >
        <Text tone="muted">본 대화 모델이 정해지지 않았어요. 연결 화면에서 별표를 찍은 모델 가운데 하나를 골라 주세요.</Text>
      </Screen>
    );
  }

  const status = reply && (reply.state === 'done' ? '완료' : reply.state === 'cut' ? '잘림' : '실패');

  return (
    <Screen
      top={<NavBar title="시험해 보기" subtitle={`본 대화 · ${model.name}`} onBack={() => navigate('/connections')} />}
      onSubmit={send}
      actions={
        <Button type="submit" icon={running ? Square : Send} variant={running ? 'secondary' : 'primary'} disabled={!running && !prompt.trim()}>
          {running ? '멈추기' : '보내기'}
        </Button>
      }
    >
      <Stack gap={12}>
        <Text size="sm" tone="muted">
          <Tag>{connection.value.label}</Tag> {model.id}
        </Text>
        <TextField label="보낼 말" lines={3} value={prompt} onChange={setPrompt} />
      </Stack>
      {(running || text || reasoning) && <Reply text={text} reasoning={reasoning} streaming={running} />}
      {reply?.state === 'cut' && reply.cut && <Callout tone="warn">{CUT[reply.cut]}</Callout>}
      {reply?.error && reply.error.kind !== 'stopped' && (
        <Callout tone="warn" alert>
          {describeReplyError(reply.error)}
        </Callout>
      )}
      {reply && (
        <Facts
          items={[
            { label: '결과', value: status! },
            { label: '첫 글자까지', value: seconds(reply.firstTextMs) },
            { label: '전체 시간', value: seconds(reply.totalMs) },
            { label: '입력 토큰', value: tokens(reply.usage?.inputTokens ?? null) },
            { label: '출력 토큰', value: tokens(reply.usage?.outputTokens ?? null) },
            { label: '비용', value: cost(reply.cost) },
            { label: '끝난 이유', value: reply.finishReason ?? UNKNOWN },
          ]}
        />
      )}
    </Screen>
  );
}
