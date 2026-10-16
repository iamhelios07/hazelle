import { useMemo, useState } from 'react';
import type { From } from '../../engine/pipeline';
import { cacheTurns, type CacheTurn, type ForecastPart } from '../../runtime/cache';
import { cost, tokens } from '../common/receipt';
import { ago } from '../common/time';
import { MODEL_SETTINGS, opens, UNKNOWN } from '../common/words';
import { useStore } from '../session';
import { navigate } from '../shell/router';
import { Button, Callout, Empty, Facts, List, ListItem, Section, Stack, Text } from '../ui';
import { BROKEN, profileName, reads, why } from './ChatCache';
import { partName } from './ChatSent';
import type { Side } from './panels';
import type { OpenChat } from './useChat';
import type { CacheNotes } from './useSendNotes';

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

export function CacheTab({ cache, messages, busy, editor, onEdit }: Pick<OpenChat, 'messages' | 'busy'> & { cache: CacheNotes; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
  const turns = useMemo(() => cacheTurns(messages), [messages]);
  const [more, setMore] = useState(PAGE);
  return (
    <>
        <Section title="다음 전송 예상" help="지금 보내면 어떻게 될지 입력 내용과 프롬프트로 미리 계산해요. 토큰 수는 추정치예요.">
          {busy ? <Empty variant="section">응답이 끝나면 다시 계산해요.</Empty> : cache.next ? <Next next={cache.next} editor={editor} onEdit={onEdit} /> : cache.next === null && <Empty variant="section">계산할 캐시가 없어요.</Empty>}
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
            <Empty variant="section">보낸 요청이 없어요.</Empty>
          )}
        </Section>
    </>
  );
}

type NextProps = { next: NonNullable<CacheNotes['next']>; editor: (from: From) => Side | null; onEdit: (side: Side) => void };

function Next({ next: { forecast, cost: price, route }, editor, onEdit }: NextProps) {
  const store = useStore();
  const { against, written, tail, removed } = forecast;
  const off = against?.broken?.kind === 'off' ? { label: opens(MODEL_SETTINGS), onClick: () => navigate({ kind: 'model', connection: route.connection.id, model: route.model.id }) } : undefined;
  return (
    <Stack gap="group">
      {against?.broken && <Callout tone="warn" action={off}>{`${BROKEN}: ${why(against.broken, profileName(store, route))} ${reads(against)}`}</Callout>}
      <Facts
        variant="tiles"
        items={[
          { label: STATES.read, value: against ? tokens(against.read) : UNKNOWN, ...(!against && { tone: 'muted' as const }) },
          { label: STATES.write, value: tokens(written) },
          { label: STATES.tail, value: tokens(tail) },
        ]}
      />
      {!against && <Text variant="note">직전 요청 기록이 없어서 얼마나 읽을지 알 수 없어요.</Text>}
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
      detail={forecast?.broken && <Text variant="note">{`${BROKEN}: ${why(forecast.broken, null)}`}</Text>}
    />
  );
}
