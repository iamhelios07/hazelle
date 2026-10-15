import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { calls, shown, type Receipt } from '../../model/chat';
import { describeReplyError } from '../common/failure';
import { ago } from '../common/time';
import { useChatMemory, useSession } from '../session';
import { Breakdown, Callout, Empty, Facts, IconButton, Section, SidePanel, Stack, Tab, Tabs, Text } from '../ui';
import { SentLore, SentMemory, SentRequest, SentResponse } from './ChatSent';
import { cost, seconds, speed, tokens } from '../common/receipt';
import { DISCOUNT, UNKNOWN } from '../common/words';
import { infoReply } from './infoReply';
import type { OpenChat } from './useChat';

const CUT = { length: '길이 한도', stopped: '직접 중단', 'no-terminal': '중간에 끊김' } as const;

const TABS = [
  { value: 'reply', label: '응답' },
  { value: 'lore', label: '로어북' },
  { value: 'memory', label: '기억' },
  { value: 'request', label: '요청 원문' },
  { value: 'response', label: '응답 원문' },
] as const;

function finish(receipt: Receipt): { label: string; value: string; tone?: 'warn' } {
  if (receipt.state === 'failed') return { label: '종료 사유', value: '실패', tone: 'warn' };
  if (receipt.cut) return { label: '종료 사유', value: CUT[receipt.cut], tone: receipt.cut === 'stopped' ? undefined : 'warn' };
  return { label: '종료 사유', value: '정상 종료' };
}

const outcomeFacts = (receipt: Receipt) => [
  { label: '비용', value: cost(receipt.cost), tone: receipt.cost === null ? ('muted' as const) : undefined },
  finish(receipt),
  { label: '첫 토큰까지', value: seconds(receipt.firstTextMs) },
  { label: '속도', value: speed(receipt.usage?.outputTokens ?? null, receipt.firstTextMs, receipt.totalMs) },
  ...(receipt.discount ? [{ label: DISCOUNT, value: '받음' }] : []),
  ...(receipt.tries ? [{ label: '보낸 횟수', value: `${receipt.tries}번` }] : []),
];
const callFacts = (receipt: Receipt) => [
  { label: '입력', value: tokens(receipt.usage?.inputTokens ?? null) },
  { label: '출력', value: tokens(receipt.usage?.outputTokens ?? null) },
  ...outcomeFacts(receipt),
];

type Props = Pick<OpenChat, 'id' | 'messages' | 'infoPick'> & {
  onPick: (id: string) => void;
  // Absent while 장기 기억's 기능 is off, which leaves out the 기억 tab that opens its panel.
  onRecord?: (id: string | null) => void;
  onClose: () => void;
};

export function ChatInfo({ id: chat, messages, infoPick, onPick, onRecord, onClose }: Props) {
  const { talk, costs } = useSession();
  const memory = useChatMemory(chat);
  const [picked, setTab] = useState<(typeof TABS)[number]['value']>('reply');
  const tab = picked === 'memory' && !onRecord ? 'reply' : picked;
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
      <IconButton icon={ChevronLeft} label="이전 응답 정보" size="sm" disabled={at <= 0} onClick={() => onPick(replies[at - 1]!.id)} />
      <IconButton icon={ChevronRight} label="다음 응답 정보" size="sm" disabled={at >= replies.length - 1} onClick={() => onPick(replies[at + 1]!.id)} />
    </>
  );

  let body;
  // A continued reply thought in each of its calls; one call that did not say leaves the total unknown.
  const counts = receipt ? calls(receipt).map((call) => call.usage?.reasoningTokens ?? null) : [];
  const reasoned = counts.includes(null) ? null : counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const thought = version && (version.reasoning || reasoned) && (
    <Section level={3} title="추론" note={reasoned ? `${tokens(reasoned)} 토큰` : undefined}>
      {version.reasoning ? <Text variant="prose">{version.reasoning}</Text> : <Empty variant="section">모델이 추론 글을 보내지 않았어요.</Empty>}
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
    const sent = talk.sent(receipt.id);
    body = (
      <>
        <Tabs label="응답 정보">
          {TABS.filter((each) => each.value !== 'memory' || onRecord).map((each) => (
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
                    <Facts variant="tiles" items={callFacts(call)} />
                  </Stack>
                ))}
              </Section>
            )}
          </>
        )}
        {tab === 'lore' && <SentLore sent={sent} />}
        {tab === 'memory' && onRecord && <SentMemory sent={sent} memory={memory} onRecord={onRecord} />}
        {tab === 'request' && <SentRequest sent={sent} receipt={receipt} />}
        {tab === 'response' && <SentResponse sent={sent} />}
      </>
    );
  }

  return (
    <SidePanel title="응답 정보" subtitle={version ? ago(version.at) : undefined} actions={replies.length > 1 && stepper} onClose={onClose}>
      {body}
    </SidePanel>
  );
}

function TranslationCall({ receipt }: { receipt: Receipt }) {
  return (
    <>
      <Section level={3} title="번역">
        <Text variant="note">{`${receipt.modelName} · ${receipt.source}`}</Text>
        <Facts variant="tiles" items={callFacts(receipt)} />
      </Section>
      <Fitting receipt={receipt} title="번역 토큰 맞추기" />
    </>
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
      <Facts variant="tiles" items={[...(usage ? [] : [{ label: '토큰', value: UNKNOWN, tone: 'muted' as const }]), ...outcomeFacts(receipt)]} />
      <Fitting receipt={receipt} />
    </>
  );
}

const UNMEASURED = { preparation: '요청을 만들기 전에 멈춤', tokenizer: '토큰 수를 세지 못함' } as const;
const UNLEARNED = { pictures: '이미지가 있어 배우지 않음', incomplete: '끝까지 받지 못해 배우지 않음', 'missing-input': '제공자가 입력 토큰을 알려 주지 않음', empty: '보낸 글이 없음' } as const;
const SOURCE = { prior: '기본값', model: '이 모델의 기록', chat: '이 채팅의 기록', 'drift-reset': '바뀐 배율을 다시 배우는 중', unavailable: '맞추지 않음' } as const;
const BOUND = { 'hard-upper': '모델 한도에 여유를 두고', 'hard-centre': '모델 한도 기준', 'user-centre': '설정한 컨텍스트 기준', refusal: '거절된 뒤 줄여서' } as const;

function Fitting({ receipt, title = '토큰 맞추기' }: { receipt: Receipt; title?: string }) {
  const { tokens: calibration } = useSession();
  const fit = calibration.call(receipt);
  // A receipt from before calibration has nothing to show, which is not the same as a call that could not be measured.
  if (fit.unavailable === 'historical') return null;
  const learned = fit.source === 'model' || fit.source === 'chat' || fit.source === 'drift-reset';
  return (
    <Section level={3} title={title} help="모델마다 토큰을 세는 방식이 달라요. 응답마다 제공자가 알려 준 입력 토큰과 앱이 센 토큰을 비교해 배율을 배우고, 그 배율로 프롬프트를 모델 한도에 맞춰요.">
      <Facts
        variant="tiles"
        items={[
          fit.denominator === null
            ? { label: '앱이 센 입력', value: UNKNOWN, tone: 'muted', detail: fit.unavailable ? [UNMEASURED[fit.unavailable]] : undefined }
            : { label: '앱이 센 입력', value: `약 ${tokens(fit.denominator)}` },
          fit.ratio === null
            ? { label: '이번 배율', value: UNKNOWN, tone: 'muted', detail: fit.ineligible ? [UNLEARNED[fit.ineligible]] : undefined }
            : { label: '이번 배율', value: `×${fit.ratio.toFixed(2)}` },
          { label: '맞춘 기준', value: SOURCE[fit.source], tone: fit.source === 'unavailable' ? 'muted' : undefined, detail: learned ? [`기록 ${Math.max(1, Math.round(fit.evidence))}개 반영`] : undefined },
          ...(fit.bound === null && fit.allowance === null
            ? []
            : [{ label: '보낼 수 있던 입력', value: fit.allowance === null ? UNKNOWN : `약 ${tokens(fit.allowance)}`, detail: [fit.bound ? BOUND[fit.bound] : '모델 한도를 몰라 줄이지 않음', ...(fit.multiplier === null ? [] : [`배율 ×${fit.multiplier.toFixed(2)} 적용`])] }]),
          ...(fit.retries.length ? [{ label: '길이 초과로 다시 보냄', value: `${fit.retries.length}번`, tone: 'warn' as const }] : []),
        ]}
      />
    </Section>
  );
}
