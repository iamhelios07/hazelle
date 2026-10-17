import { useState, useSyncExternalStore } from 'react';
import type { HookLog } from '../../engine/lua/run';
import type { PackOwner } from '../../model/library';
import { ago } from '../common/time';
import { useSession } from '../session';
import { Callout, CodeBlock, Empty, Facts, List, ListItem, Section, Stack, Text } from '../ui';
import { shownValue } from './InspectVariables';

export const STAGES: Record<string, string> = { load: '처음 실행', onInput: '입력', editInput: '입력 편집', onStart: '시작', editRequest: '요청 편집', editOutput: '응답 편집', onOutput: '응답', editDisplay: '화면 편집', button: '버튼',
  reply: '응답 저장', replying: '응답 편집', prompt: '프롬프트', change: '메시지 변경', branch: '분기', menu: '메뉴', action: '메시지 도구', call: '도구 호출',
};

export function Scripts({ chat }: { chat: string }) {
  const { scripts } = useSession();
  const log = useSyncExternalStore(
    (listener) => scripts.subscribeLog(chat, listener),
    () => scripts.log(chat),
  );
  const entries = log.entries.map((entry, index) => ({ entry, key: `${entry.at}:${log.omitted + index}` })).reverse();
  return (
    <Section title="실행 기록" help="이 화면에서 실행된 봇 스크립트와 log() 출력 내용이에요. 새로고침하면 사라져요.">
      {entries.length === 0 ? (
        <Empty variant="section">실행된 스크립트가 없어요.</Empty>
      ) : (
        <Stack gap="related">
          <HookList label="실행 기록" entries={entries} aside={(entry) => `${ago(entry.at)} · ${Math.round(entry.duration)}ms`} />
          {log.omitted > 0 && <Text variant="note">{`오래된 기록 ${log.omitted}개는 빠졌어요.`}</Text>}
        </Stack>
      )}
    </Section>
  );
}

export function HookList({ label, entries, aside }: { label: string; entries: { entry: HookLog; key: string }[]; aside: (entry: HookLog) => string }) {
  const { store } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const packName = (pack: PackOwner | null) => (pack === null ? null : pack.kind === 'module' ? store.get('module', pack.id)?.value.name : store.get('character', pack.id)?.value.card.name) ?? null;
  return (
    <List label={label}>
      {entries.map(({ entry, key }) => (
        <ListItem
          key={key}
          title={`${STAGES[entry.stage] ?? entry.stage} · ${entry.script || packName(entry.pack) || 'Lua'}`}
          badge={entry.errors.length ? '오류' : undefined}
          tags={hookTags(entry)}
          aside={aside(entry)}
          expanded={open === key}
          onClick={() => setOpen(open === key ? null : key)}
          detail={open === key && <HookDetail entry={entry} />}
        />
      ))}
    </List>
  );
}

function hookTags(entry: HookLog): string[] {
  return [
    ...(entry.stopped ? ['멈춤'] : []),
    ...(entry.changed ? ['바꿈'] : []),
    ...(entry.writes.length ? [`변수 ${entry.writes.length}개`] : []),
    ...(entry.logs.length ? [`log ${entry.logs.length}줄`] : []),
    ...(entry.missing.length ? [`지원 안 함 ${entry.missing.length}개`] : []),
  ];
}

function HookDetail({ entry }: { entry: HookLog }) {
  return (
    <Stack gap="related">
      {entry.errors.map((error, index) => (
        <Callout key={index} tone="warn">{'message' in error ? error.message : `${error.script} 실패`}</Callout>
      ))}
      {entry.logs.length > 0 && <CodeBlock>{entry.logs.join('\n')}</CodeBlock>}
      {entry.writes.length > 0 && <Facts items={entry.writes.map(([name, value]) => ({ label: name, value: shownValue(value, false) }))} />}
      {entry.missing.length > 0 && <Text variant="note">{`지원하지 않는 기능: ${entry.missing.join(', ')}`}</Text>}
      {entry.truncated && <Text variant="note">내용이 길어서 일부만 남겼어요.</Text>}
    </Stack>
  );
}
