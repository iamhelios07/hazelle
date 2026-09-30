import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { calls, shown, type Receipt } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import { describeReplyError } from '../common/failure';
import { ago } from '../common/time';
import { useSession } from '../session';
import { Breakdown, Callout, Empty, Facts, IconButton, Section, SidePanel, Stack, Tab, Tabs, Text } from '../ui';
import { SentLore, SentRequest } from './ChatSent';
import { cost, seconds, speed, tokens, UNKNOWN } from '../common/receipt';

type Props = {
  chat: string | null;
  messages: Shown[];
  // The reply shown; the latest when it is gone.
  id: string | null;
  onShow: (id: string) => void;
  onClose: () => void;
};

const CUT = { length: '길이 한도', stopped: '직접 멈춤', 'no-terminal': '끝 표시 없이 끊김' } as const;

const TABS = [
  { value: 'reply', label: '답장' },
  { value: 'lore', label: '로어북' },
  { value: 'request', label: '요청 원문' },
] as const;

function finish(receipt: Receipt): { label: string; value: string; tone?: 'warn' } {
  if (receipt.state === 'failed') return { label: '끝난 이유', value: '실패', tone: 'warn' };
  if (receipt.cut) return { label: '끝난 이유', value: CUT[receipt.cut], tone: receipt.cut === 'stopped' ? undefined : 'warn' };
  return { label: '끝난 이유', value: '정상 종료' };
}

const tokenFacts = (receipt: Receipt) => [
  { label: '보냄', value: tokens(receipt.usage?.inputTokens ?? null) },
  { label: '답장', value: tokens(receipt.usage?.outputTokens ?? null) },
];
const costFact = (receipt: Receipt) => ({ label: '비용', value: cost(receipt.cost), tone: receipt.cost === null ? ('muted' as const) : undefined });
const timeFacts = (receipt: Receipt) => [
  { label: '첫 글자까지', value: seconds(receipt.firstTextMs) },
  { label: '속도', value: speed(receipt.usage?.outputTokens ?? null, receipt.firstTextMs, receipt.totalMs) },
];

export function ChatInfo({ chat, messages, id, onShow, onClose }: Props) {
  const { talk, costs } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('reply');
  const replies = messages.filter((message) => message.role === 'assistant');
  const reply = replies.find((message) => message.id === id) ?? replies.at(-1);
  const at = reply ? replies.indexOf(reply) : -1;
  const version = reply && shown(reply);
  const receipt = version?.receipt ?? null;
  const translated = version?.translation?.receipt ?? null;
  const live = reply !== undefined && reply.live === version?.id;

  // A cost still 확인 중 after a reload is looked up again, for every call a continued reply took and its translation.
  useEffect(() => {
    if (!chat) return;
    for (const call of [...(receipt ? calls(receipt) : []), ...(translated ? [translated] : [])]) costs.settle(chat, call);
  }, [chat, receipt, translated, costs]);

  const stepper = (
    <>
      <IconButton icon={ChevronLeft} label="이전 답장 정보" size="sm" disabled={at <= 0} onClick={() => onShow(replies[at - 1]!.id)} />
      <IconButton icon={ChevronRight} label="다음 답장 정보" size="sm" disabled={at >= replies.length - 1} onClick={() => onShow(replies[at + 1]!.id)} />
    </>
  );

  let body;
  if (!version) body = <Empty>이 채팅에는 아직 답장이 없어요.</Empty>;
  else if (live) body = <Text tone="muted">답장을 쓰는 중이에요. 끝나면 토큰과 비용이 채워져요.</Text>;
  else if (!receipt) {
    body = (
      <>
        <Empty>모델이 만든 답장이 아니라서 토큰이나 비용 정보가 없어요.</Empty>
        {translated && <TranslationCall receipt={translated} />}
      </>
    );
  }
  else {
    const earlier = calls(receipt).slice(0, -1);
    const sent = talk.sent(version.id);
    body = (
      <>
        <Tabs label="답장 정보">
          {TABS.map((each) => (
            <Tab key={each.value} label={each.label} current={tab === each.value} onClick={() => setTab(each.value)} />
          ))}
        </Tabs>
        {earlier.length > 0 && tab !== 'reply' && <Text tone="muted">이어 쓴 답장이에요. 아래는 마지막 이어 쓰기가 보낸 요청이에요.</Text>}
        {tab === 'reply' && (
          <>
            {version.edited && <Text tone="muted">직접 수정한 답장이에요. 아래는 수정하기 전 답장을 받았을 때의 정보예요.</Text>}
            {earlier.length > 0 && (
              <Text tone="muted">{`이어 쓴 답장이에요. 호출 ${earlier.length + 1}번으로 만들었고, 비용은 호출마다 따로 들어요. 아래는 마지막 호출이고, 앞선 호출은 맨 아래에 있어요.`}</Text>
            )}
            <Call receipt={receipt} />
            {translated && <TranslationCall receipt={translated} />}
            {earlier.length > 0 && (
              <Section level={3} title="앞선 호출">
                {earlier.map((call, index) => (
                  <Stack key={index} gap="related">
                    <Text size="sm" tone="muted">{`${index === 0 ? '처음 답장' : `이어 쓰기 ${index}`} · ${call.modelName} · ${call.source}`}</Text>
                    <Facts
                      variant="tiles"
                      items={[...tokenFacts(call), costFact(call), finish(call), ...timeFacts(call)]}
                    />
                  </Stack>
                ))}
              </Section>
            )}
          </>
        )}
        {tab === 'lore' && <SentLore sent={sent} />}
        {tab === 'request' && <SentRequest sent={sent} receipt={receipt} />}
      </>
    );
  }

  return (
    <SidePanel title="답장 정보" subtitle={version ? ago(version.at) : undefined} actions={replies.length > 1 && stepper} onClose={onClose}>
      {body}
    </SidePanel>
  );
}

function TranslationCall({ receipt }: { receipt: Receipt }) {
  return (
    <Section level={3} title="번역">
      <Text size="sm" tone="muted">{`${receipt.modelName} · ${receipt.source}`}</Text>
      <Facts
        variant="tiles"
        items={[...tokenFacts(receipt), costFact(receipt), finish(receipt)]}
      />
    </Section>
  );
}

function Call({ receipt }: { receipt: Receipt }) {
  const usage = receipt.usage;
  const cached = usage?.cachedInputTokens ?? null;
  const input = usage?.inputTokens ?? null;
  const fresh = input !== null && cached !== null ? input - cached : null;
  // Counted in fresh: the tokens this call sent that the next one can read from the cache.
  const written = usage?.cacheWriteInputTokens ?? null;
  return (
    <>
      <Section level={3} title="모델">
        <Text>{receipt.modelName}</Text>
        <Text size="sm" tone="muted">
          {receipt.source}
        </Text>
      </Section>
      {receipt.state === 'failed' && (
        <Section level={3} title="결과">
          <Callout tone="warn">
            {receipt.error ? describeReplyError(receipt.error) : UNKNOWN} 보낸 뒤 {seconds(receipt.totalMs)} 만에 돌아왔어요.
          </Callout>
        </Section>
      )}
      {usage ? (
        <Section level={3} title="토큰" note={[input && cached !== null && `캐시 적중 ${Math.round((cached / input) * 100)}%`, written && `캐시에 저장 ${tokens(written)}`].filter(Boolean).join(' · ') || undefined}>
          <Breakdown
            shares={input && fresh !== null ? [cached! / input, fresh / input] : null}
            parts={
              cached === null
                ? [
                    { label: '보냄', value: tokens(input), mark: 'plain' },
                    { label: '답장', value: tokens(usage.outputTokens), mark: 'outline' },
                  ]
                : [
                    { label: '캐시에서 읽음', value: tokens(cached), mark: 'accent' },
                    { label: '새로 보냄', value: tokens(fresh), mark: 'plain' },
                    { label: '답장', value: tokens(usage.outputTokens), mark: 'outline' },
                  ]
            }
          />
        </Section>
      ) : (
        <Empty variant="section">제공자가 사용량을 알려 주지 않았어요. 모르는 값은 0으로 적지 않아요.</Empty>
      )}
      <Facts variant="tiles" items={[...(usage ? [] : [{ label: '토큰', value: UNKNOWN, tone: 'muted' as const }]), costFact(receipt), finish(receipt), ...timeFacts(receipt)]} />
    </>
  );
}
