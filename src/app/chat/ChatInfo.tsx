import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { calls, shown, type Receipt } from '../../model/chat';
import { describeReplyError } from '../common/failure';
import { ago } from '../common/time';
import { useChatMemory, useSession } from '../session';
import { Breakdown, Callout, Empty, Facts, IconButton, Section, SidePanel, Stack, Tab, Tabs, Text } from '../ui';
import { SentLore, SentMemory, SentRequest } from './ChatSent';
import { cost, seconds, speed, tokens, UNKNOWN } from '../common/receipt';
import { infoReply } from './infoReply';
import type { OpenChat } from './useChat';

const CUT = { length: '길이 한도', stopped: '직접 중단', 'no-terminal': '중간에 끊김' } as const;

const TABS = [
  { value: 'reply', label: '응답' },
  { value: 'lore', label: '로어북' },
  { value: 'memory', label: '기억' },
  { value: 'request', label: '요청 원문' },
] as const;

function finish(receipt: Receipt): { label: string; value: string; tone?: 'warn' } {
  if (receipt.state === 'failed') return { label: '종료 사유', value: '실패', tone: 'warn' };
  if (receipt.cut) return { label: '종료 사유', value: CUT[receipt.cut], tone: receipt.cut === 'stopped' ? undefined : 'warn' };
  return { label: '종료 사유', value: '정상 종료' };
}

const tokenFacts = (receipt: Receipt) => [
  { label: '입력', value: tokens(receipt.usage?.inputTokens ?? null) },
  { label: '출력', value: tokens(receipt.usage?.outputTokens ?? null) },
];
const costFact = (receipt: Receipt) => ({ label: '비용', value: cost(receipt.cost), tone: receipt.cost === null ? ('muted' as const) : undefined });
const timeFacts = (receipt: Receipt) => [
  { label: '첫 토큰까지', value: seconds(receipt.firstTextMs) },
  { label: '속도', value: speed(receipt.usage?.outputTokens ?? null, receipt.firstTextMs, receipt.totalMs) },
];

export function ChatInfo({ chat: open }: { chat: OpenChat }) {
  const { id: chat, messages, infoPick, actions } = open;
  const { talk, costs } = useSession();
  const memory = useChatMemory(chat);
  const [tab, setTab] = useState<(typeof TABS)[number]['value']>('reply');
  const replies = messages.filter((message) => message.role === 'assistant');
  const reply = infoReply(replies, infoPick);
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
      <IconButton icon={ChevronLeft} label="이전 응답 정보" size="sm" disabled={at <= 0} onClick={() => actions.pickInfo(replies[at - 1]!.id)} />
      <IconButton icon={ChevronRight} label="다음 응답 정보" size="sm" disabled={at >= replies.length - 1} onClick={() => actions.pickInfo(replies[at + 1]!.id)} />
    </>
  );

  let body;
  const thought = version?.reasoning && (
    <Section level={3} title="추론">
      <Text variant="prose">{version.reasoning}</Text>
    </Section>
  );
  if (!version) body = <Empty>응답이 없어요.</Empty>;
  else if (live) {
    body = (
      <>
        <Text variant="note">생성 중…</Text>
        {thought}
      </>
    );
  }
  else if (!receipt) {
    body = (
      <>
        <Empty>{version.reasoning ? '가져온 응답이라 토큰과 비용 정보가 없어요.' : '모델이 생성한 응답이 아니라서 토큰과 비용 정보가 없어요.'}</Empty>
        {translated && <TranslationCall receipt={translated} />}
        {thought}
      </>
    );
  }
  else {
    const earlier = calls(receipt).slice(0, -1);
    const sent = talk.sent(version.id);
    body = (
      <>
        <Tabs label="응답 정보">
          {TABS.map((each) => (
            <Tab key={each.value} label={each.label} current={tab === each.value} onClick={() => setTab(each.value)} />
          ))}
        </Tabs>
        {earlier.length > 0 && tab !== 'reply' && <Text variant="note">마지막 이어 쓰기의 요청이에요.</Text>}
        {tab === 'reply' && (
          <>
            {version.edited && <Text variant="note">수정하기 전 응답의 정보예요.</Text>}
            {earlier.length > 0 && (
              <Text variant="note">{`호출 ${earlier.length + 1}번으로 이어 쓴 응답이에요. 비용은 호출마다 들어요.`}</Text>
            )}
            <Call receipt={receipt} />
            {translated && <TranslationCall receipt={translated} />}
            {thought}
            {earlier.length > 0 && (
              <Section level={3} title="이전 호출">
                {earlier.map((call, index) => (
                  <Stack key={index} gap="related">
                    <Text variant="note">{`${index === 0 ? '첫 응답' : `이어 쓰기 ${index}`} · ${call.modelName} · ${call.source}`}</Text>
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
        {tab === 'memory' && <SentMemory sent={sent} memory={memory} onRecord={actions.memory} />}
        {tab === 'request' && <SentRequest sent={sent} receipt={receipt} />}
      </>
    );
  }

  return (
    <SidePanel title="응답 정보" subtitle={version ? ago(version.at) : undefined} actions={replies.length > 1 && stepper} onClose={actions.closePanel}>
      {body}
    </SidePanel>
  );
}

function TranslationCall({ receipt }: { receipt: Receipt }) {
  return (
    <Section level={3} title="번역">
      <Text variant="note">{`${receipt.modelName} · ${receipt.source}`}</Text>
      <Facts
        variant="tiles"
        items={[...tokenFacts(receipt), costFact(receipt), finish(receipt), ...timeFacts(receipt)]}
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
        <Text variant="note">
          {receipt.source}
        </Text>
      </Section>
      {receipt.state === 'failed' && (
        <Section level={3} title="결과">
          <Callout tone="warn">
            {receipt.error && `${describeReplyError(receipt.error)} `}{seconds(receipt.totalMs)} 만에 실패했어요.
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
                    { label: '입력', value: tokens(input), mark: 'plain' },
                    { label: '출력', value: tokens(usage.outputTokens), mark: 'outline' },
                  ]
                : [
                    { label: '캐시에서 읽음', value: tokens(cached), mark: 'accent' },
                    { label: '새 입력', value: tokens(fresh), mark: 'plain' },
                    { label: '출력', value: tokens(usage.outputTokens), mark: 'outline' },
                  ]
            }
          />
        </Section>
      ) : (
        <Empty variant="section">제공자가 사용량을 알려 주지 않았어요.</Empty>
      )}
      <Facts variant="tiles" items={[...(usage ? [] : [{ label: '토큰', value: UNKNOWN, tone: 'muted' as const }]), costFact(receipt), finish(receipt), ...timeFacts(receipt)]} />
    </>
  );
}
