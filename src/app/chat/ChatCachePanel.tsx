import { useMemo, useState } from 'react';
import type { From } from '../../engine/pipeline';
import { cacheTurns, type CacheTurn, type Forecast, type ForecastPart } from '../../runtime/cache';
import { cost, tokens } from '../common/receipt';
import { ago } from '../common/time';
import { UNKNOWN } from '../common/words';
import { useSession } from '../session';
import { Button, Callout, Empty, Facts, List, ListItem, Section, SidePanel, Stack, Text } from '../ui';
import { BROKEN, reads, why } from './ChatCache';
import { partName } from './ChatSent';
import { editorOf, type Side } from './panels';
import type { OpenChat } from './useChat';

const PAGE = 20;

const STATES: Record<ForecastPart['state'], string> = { read: '캐시에서 읽음', write: '새로 저장', tail: '캐시 밖' };
const CHANGES = { changed: '달라짐', added: '추가됨' } as const;

type Row = { name: string; tokens: number; count: number } & Pick<ForecastPart, 'from' | 'state' | 'change' | 'point'>;

// Neighbours of one part, alike in how the cache takes them, read as one row; a point ends its row. A changed part is
// a row of its own, so its from is the row's.
function rows(parts: ForecastPart[]): Row[] {
  const out: Row[] = [];
  for (const part of parts) {
    const name = partName(part.from, part.role);
    const open = out.at(-1);
    if (open && !open.point && !open.change && !part.change && open.name === name && open.state === part.state) {
      open.tokens += part.tokens;
      open.count++;
      open.point = part.point;
    } else out.push({ name, tokens: part.tokens, count: 1, from: part.from, state: part.state, change: part.change, point: part.point });
  }
  return out;
}

// 캐시 (design §4.4): what sending the draft now would read, write and leave out of the cache, kept up as the draft, the
// prompt or a lorebook changes; and what each earlier call read, with why its send expected less.
export function ChatCachePanel({ cache, messages, busy, prompt, character, onClose, onEdit }: Pick<OpenChat, 'cache' | 'messages' | 'busy' | 'prompt'> & { character: string | null; onClose: () => void; onEdit: (side: Side) => void }) {
  const { store } = useSession();
  const conversation = prompt.kind === 'prompt' ? { id: prompt.prompt.id, blocks: prompt.prompt.value.blocks } : null;
  const editor = (from: From) => editorOf(from, conversation, character, (lore) => store.get('lore', lore)?.parent ?? null);
  const turns = useMemo(() => cacheTurns(messages), [messages]);
  const [more, setMore] = useState(PAGE);
  return (
    <SidePanel title="캐시" onClose={onClose}>
      <Stack gap="section">
        <Section title="다음 전송 예상" help="지금 보내면 어떻게 될지 입력과 프롬프트로 미리 계산해요. 토큰 수는 추정이에요.">
          {busy ? <Empty variant="section">응답이 끝나면 다시 계산해요.</Empty> : cache.next ? <Next forecast={cache.next.forecast} price={cache.next.cost} editor={editor} onEdit={onEdit} /> : cache.next === null && <Empty variant="section">계산할 캐시가 없어요.</Empty>}
        </Section>
        <Section title="지난 요청">
          {turns.length ? (
            <Stack gap="related">
              <List label="지난 요청">
                {turns.slice(0, more).map((turn) => (
                  <Turn key={turn.call} turn={turn} />
                ))}
              </List>
              {turns.length > more && (
                <Button variant="secondary" size="sm" onClick={() => setMore(more + PAGE)}>
                  더 보기
                </Button>
              )}
            </Stack>
          ) : (
            <Empty variant="section">아직 보낸 요청이 없어요.</Empty>
          )}
        </Section>
      </Stack>
    </SidePanel>
  );
}

type NextProps = { forecast: Forecast; price: NonNullable<OpenChat['cache']['next']>['cost']; editor: (from: From) => Side | null; onEdit: (side: Side) => void };

function Next({ forecast, price, editor, onEdit }: NextProps) {
  const { against, written, tail, removed } = forecast;
  return (
    <Stack gap="group">
      {against?.broken && <Callout tone="warn">{`${BROKEN}: ${why(against.broken)} ${reads(against)}`}</Callout>}
      <Facts
        variant="tiles"
        items={[
          { label: STATES.read, value: against ? tokens(against.read) : UNKNOWN, ...(!against && { tone: 'muted' as const }) },
          { label: STATES.write, value: tokens(written) },
          { label: STATES.tail, value: tokens(tail) },
        ]}
      />
      {!against && <Text variant="note">직전 요청 기록이 없어서 읽을 양은 알 수 없어요.</Text>}
      {price && (
        <Facts
          items={[
            { label: '이대로 보내면', value: cost(price.paid) },
            { label: '캐시를 다 읽으면', value: cost(price.whole) },
          ]}
        />
      )}
      <List label="보낼 메시지">
        {rows(forecast.parts).map((row, index) => {
          const side = row.change && editor(row.from);
          return (
            <ListItem
              key={index}
              title={row.count > 1 ? `${row.name} ${row.count}개` : row.name}
              badge={row.change ? CHANGES[row.change] : undefined}
              tags={[STATES[row.state], ...(row.point === 'cache' ? ['캐시 지점'] : row.point === 'short' ? ['캐시 지점 · 최소 크기 미만'] : [])]}
              aside={tokens(row.tokens)}
              onClick={side ? () => onEdit(side) : undefined}
            />
          );
        })}
      </List>
      {removed.length > 0 && (
        <Section level={3} title="빠지는 메시지">
          <List label="빠지는 메시지">
            {removed.map((part, index) => (
              <ListItem key={index} title={partName(part.from, part.role)} aside={tokens(part.tokens)} />
            ))}
          </List>
        </Section>
      )}
    </Stack>
  );
}

function Turn({ turn }: { turn: CacheTurn }) {
  const { input, read, written, forecast } = turn;
  const counted = input !== null && read !== null;
  const rest = counted ? input - read - (written ?? 0) : null;
  return (
    <ListItem
      title={turn.modelName}
      badge={counted && input > 0 ? `적중 ${Math.round((read / input) * 100)}%` : undefined}
      description={counted ? `읽음 ${tokens(read)} · 저장 ${tokens(written)} · 그 외 ${tokens(rest)}` : `사용량 ${UNKNOWN}`}
      aside={ago(turn.at)}
      detail={forecast?.broken && <Text variant="note">{`${BROKEN}: ${why(forecast.broken)}`}</Text>}
    />
  );
}
