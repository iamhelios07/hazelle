import { useEffect, useMemo, useState } from 'react';
import type { VariableInspection, VariableWriter } from '../../engine/render';
import { inspectToggles } from '../../runtime/chat-context';
import type { Sending } from '../../runtime/turn-context';
import { useSearch } from '../common/useSearch';
import { UNKNOWN } from '../common/words';
import { useSession } from '../session';
import { Empty, List, ListItem, Section, Stack, Text } from '../ui';

const SCRIPT_STAGE = { input: '입력', output: '출력', greeting: '첫 메시지', staged: '대기 중인 메시지' } as const;

function writerName(writer: VariableWriter): string {
  switch (writer.kind) {
    case 'card':
      return '캐릭터 기본값';
    case 'chat':
      return '채팅에 저장된 값';
    case 'pending':
      return '이번 전송';
    case 'script':
      return `${writer.index + 1}번째 메시지 · 스크립트`;
    case 'cbs':
      return `${writer.index + 1}번째 메시지 · ${SCRIPT_STAGE[writer.stage]} CBS`;
  }
}

export const shownValue = (value: string, truncated: boolean) => (value === '' ? '(빈 값)' : truncated ? `${value}…` : value);

export function Variables({ chat, sending, busy }: { chat: string; sending: Sending | null | undefined; busy: boolean }) {
  const { store } = useSession();
  const [inspected, setInspected] = useState<VariableInspection | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!sending || busy) return;
    const controller = new AbortController();
    store.evaluation.variables({ asker: 'view', chat }, sending.turn.scope, '', controller.signal).then(
      (result) => !controller.signal.aborted && setInspected(result),
      () => !controller.signal.aborted && setInspected(null),
    );
    return () => controller.abort();
  }, [chat, sending, busy]);
  const toggles = useMemo(() => (sending ? inspectToggles(store, sending.turn.chat) : []), [sending]);
  const variables = inspected?.variables ?? [];
  const search = useSearch(variables, '변수 검색', ({ name, last }) => [name, last.value]);
  return (
    <Stack gap="section">
      <Section title="변수" help="지금까지의 대화를 처음부터 다시 읽어서 계산한 값이에요. 누르면 값이 언제 바뀌었는지 볼 수 있어요.">
        {inspected === undefined ? (
          <Text variant="note">읽는 중…</Text>
        ) : inspected === null ? (
          <Empty variant="section">변수를 읽지 못했어요.</Empty>
        ) : variables.length === 0 ? (
          <Empty variant="section">이 채팅에는 변수가 없어요.</Empty>
        ) : (
          <Stack gap="related">
            {search.field}
            {search.none ?? (
              <List label="변수">
                {search.found.map((variable) => (
                  <ListItem
                    key={variable.name}
                    title={variable.name}
                    description={shownValue(variable.last.value, variable.last.truncated)}
                    aside={writerName(variable.last.writer)}
                    expanded={open === variable.name}
                    onClick={() => setOpen(open === variable.name ? null : variable.name)}
                    detail={
                      open === variable.name && (
                        <List label={`${variable.name} 기록`}>
                          {[...variable.history].reverse().map((write, index) => (
                            <ListItem key={index} title={shownValue(write.value, write.truncated)} aside={writerName(write.writer)} />
                          ))}
                        </List>
                      )
                    }
                  />
                ))}
              </List>
            )}
            {inspected.omitted > 0 && <Text variant="note">{`변수 ${inspected.omitted}개는 너무 많아서 보여 주지 않아요.`}</Text>}
          </Stack>
        )}
      </Section>
      {toggles.length > 0 && (
        <Section title="토글" help="봇이 toggle_이라는 이름으로 읽는 값이에요.">
          <List label="토글">
            {toggles.map(({ declaration, value }) => (
              <ListItem key={declaration.key} title={declaration.label || declaration.key} code={`toggle_${declaration.key}`} aside={value === null ? UNKNOWN : shownValue(value, false)} />
            ))}
          </List>
        </Section>
      )}
    </Stack>
  );
}
