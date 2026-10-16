import { tokenGroups, type From, type TokenSource } from '../../engine/pipeline';
import { afterEnter, type AfterEnter, type Sending } from '../../runtime/turn-context';
import { SLOT } from '../common/prompt-words';
import { tokens } from '../common/receipt';
import { useSession } from '../session';
import { Disclosure, Gauge, List, ListItem, Stack, Text } from '../ui';
import { partName, RequestView } from './ChatSent';
import { STAGES } from './InspectScripts';
import type { Side } from './panels';
import type { SendNotes } from './useSendNotes';

function later(steps: AfterEnter[]): string[] {
  const hooks = steps.flatMap((step) => (step.kind === 'hook' ? [STAGES[step.stage]!] : []));
  return steps.flatMap((step) => {
    switch (step.kind) {
      case 'input-translation':
        return ['입력 번역'];
      case 'hook':
        return step === steps.find((each) => each.kind === 'hook') ? [`봇 스크립트(${hooks.join(' · ')})`] : [];
      case 'tools':
        return ['도구의 새 답'];
      case 'retrieval':
        return ['기억 검색'];
    }
  });
}

export function NextRequest({ chat, sending, request, editor, onEdit }: { chat: string; sending: Sending; request: SendNotes['request']; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const session = useSession();
  const missing = later(afterEnter(session, chat, sending.turn));
  return (
    <Stack gap="group">
      <NextTokens sending={sending} />
      {missing.length > 0 && <Text variant="note">{`보낼 때 실행돼서 여기에는 없어요: ${missing.join(', ')}`}</Text>}
      <RequestView prompt={sending.prompt} title="보낼 순서대로" request={request} unbuilt="이 연결 방식은 요청 본문을 미리 만들어 볼 수 없어요." editor={editor} onEdit={onEdit} />
    </Stack>
  );
}

function sourceName(source: TokenSource): string {
  switch (source.kind) {
    case 'description':
    case 'persona':
    case 'memory':
    case 'lorebook':
      return SLOT[source.kind].name;
    case 'chat':
      return '대화';
    default:
      return partName(source, 'system');
  }
}

function NextTokens({ sending }: { sending: Sending }) {
  const { groups, total, fit, dropped } = tokenGroups(sending.prompt, sending.calibration);
  const counted = (source: TokenSource, count: number) => (source.kind === 'chat' ? `메시지 ${count}개` : source.kind === 'lorebook' ? `항목 ${count}개` : undefined);
  return (
    <Stack gap="group">
      <Gauge
        label="보낼 입력"
        share={fit.allowance ? total / fit.allowance : undefined}
        tone={fit.allowance && total > fit.allowance ? 'warn' : 'plain'}
        amount={`약 ${tokens(total)}`}
        of={fit.allowance === null ? undefined : `약 ${tokens(fit.allowance)}`}
        note={['앱 추정', ...(fit.allowance === null ? ['모델 한도를 알 수 없어서 내용을 줄이지 않아요'] : fit.multiplier === null ? [] : [`배율 ×${fit.multiplier.toFixed(2)} 반영`])].join(' · ')}
      />
      {dropped > 0 && <Text variant="note">{`한도를 넘어서 오래된 메시지 ${dropped}개가 빠져요.`}</Text>}
      <Disclosure label="토큰을 쓰는 곳">
        <List label="토큰을 쓰는 곳">
          {[...groups].sort((a, b) => b.tokens - a.tokens).map((group) => (
            <ListItem key={JSON.stringify(group.source)} title={sourceName(group.source)} description={counted(group.source, group.count)} aside={tokens(group.tokens)} />
          ))}
        </List>
      </Disclosure>
    </Stack>
  );
}
