import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect } from 'react';
import { shown, type Message, type Receipt } from '../../model/chat';
import { useTalk } from '../store';
import { Breakdown, Callout, Facts, IconButton, PanelSection, SidePanel, Text } from '../ui';
import { describeReplyError } from './failure';
import { cost, seconds, speed, tokens, UNKNOWN } from './receipt';
import { ago } from './time';

type Props = {
  chat: string | null;
  messages: (Message & { live: string | null })[];
  // The reply shown; the latest when it is gone.
  id: string | null;
  onShow: (id: string) => void;
  onClose: () => void;
};

const CUT = { length: '길이 한도', stopped: '직접 멈춤', 'no-terminal': '끝 표시 없이 끊김' } as const;

function finish(receipt: Receipt): { label: string; value: string; tone?: 'warn' } {
  if (receipt.state === 'failed') return { label: '끝난 이유', value: '실패', tone: 'warn' };
  if (receipt.cut) return { label: '끝난 이유', value: CUT[receipt.cut], tone: receipt.cut === 'stopped' ? undefined : 'warn' };
  return { label: '끝난 이유', value: '정상 종료' };
}

// design F3 정보: the receipt of one reply, stepping between the chat's replies with ‹ ›.
export function ChatInfo({ chat, messages, id, onShow, onClose }: Props) {
  const talk = useTalk();
  const replies = messages.filter((message) => message.role === 'assistant');
  const reply = replies.find((message) => message.id === id) ?? replies.at(-1);
  const at = reply ? replies.indexOf(reply) : -1;
  const version = reply && shown(reply);
  const receipt = version?.receipt ?? null;
  const live = reply !== undefined && reply.live === version?.id;

  // A cost still 확인 중 after a reload is looked up again.
  useEffect(() => {
    if (chat && receipt?.cost === 'pending') talk.settle(chat, receipt);
  }, [chat, receipt, talk]);

  const stepper = (
    <>
      <IconButton icon={ChevronLeft} label="이전 답장 정보" size="sm" disabled={at <= 0} onClick={() => onShow(replies[at - 1]!.id)} />
      <IconButton icon={ChevronRight} label="다음 답장 정보" size="sm" disabled={at >= replies.length - 1} onClick={() => onShow(replies[at + 1]!.id)} />
    </>
  );

  let body;
  if (!version) body = <Text tone="muted">이 채팅에는 아직 답장이 없어요.</Text>;
  else if (live) body = <Text tone="muted">답장을 쓰는 중이에요. 끝나면 토큰과 비용이 채워져요.</Text>;
  else if (!receipt) body = <Text tone="muted">모델이 만든 답장이 아니라서 토큰이나 비용 정보가 없어요.</Text>;
  else {
    const usage = receipt.usage;
    const cached = usage?.cachedInputTokens ?? null;
    const input = usage?.inputTokens ?? null;
    const fresh = input !== null && cached !== null ? input - cached : null;
    body = (
      <>
        {version.edited && <Text tone="muted">직접 고친 답장이에요. 아래는 고치기 전 답장을 받았을 때의 정보예요.</Text>}
        <PanelSection title="모델">
          <Text>{receipt.modelName}</Text>
          <Text size="sm" tone="muted">
            {receipt.source}
          </Text>
        </PanelSection>
        {receipt.state === 'failed' && (
          <PanelSection title="결과">
            <Callout tone="warn">
              {receipt.error ? describeReplyError(receipt.error) : UNKNOWN} 보낸 뒤 {seconds(receipt.totalMs)} 만에 돌아왔어요.
            </Callout>
          </PanelSection>
        )}
        {usage ? (
          <PanelSection title="토큰" note={input && cached !== null ? `캐시 적중 ${Math.round((cached / input) * 100)}%` : undefined}>
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
          </PanelSection>
        ) : (
          <Text size="sm" tone="muted">
            제공자가 사용량을 알려 주지 않았어요. 모르는 값은 0으로 적지 않아요.
          </Text>
        )}
        <Facts
          variant="tiles"
          items={[
            ...(usage ? [] : [{ label: '토큰', value: UNKNOWN, tone: 'muted' as const }]),
            { label: '비용', value: cost(receipt.cost), tone: receipt.cost === null ? 'muted' : undefined },
            finish(receipt),
            { label: '첫 글자까지', value: seconds(receipt.firstTextMs) },
            { label: '속도', value: speed(usage?.outputTokens ?? null, receipt.firstTextMs, receipt.totalMs) },
          ]}
        />
      </>
    );
  }

  return (
    <SidePanel title="답장 정보" subtitle={version ? ago(version.at) : undefined} actions={replies.length > 1 && stepper} onClose={onClose}>
      {body}
    </SidePanel>
  );
}
