import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { tokenGroups, type From, type TokenSource } from '../../engine/pipeline';
import type { HookLog } from '../../engine/lua/run';
import type { VariableInspection, VariableWriter } from '../../engine/render';
import type { PackOwner } from '../../model/library';
import { inspectToggles } from '../../runtime/chat-context';
import { afterEnter, moduleContributions, type AfterEnter, type ModuleContribution, type Sending } from '../../runtime/turn-context';
import { SLOT_NAMES } from '../common/prompt-words';
import { tokens } from '../common/receipt';
import { ago } from '../common/time';
import { useSearch } from '../common/useSearch';
import { moduleName, UNKNOWN } from '../common/words';
import { useSession } from '../session';
import { Callout, CodeBlock, Disclosure, Empty, Facts, Gauge, List, ListItem, Section, SidePanel, Stack, Tab, Tabs, Text } from '../ui';
import { CacheTab } from './ChatCacheTab';
import { partName, RequestView } from './ChatSent';
import { editorOf, type InspectTab, type Side } from './panels';
import type { OpenChat } from './useChat';
import type { SendNotes } from './useSendNotes';

const TABS: { value: InspectTab; label: string }[] = [
  { value: 'request', label: '요청' },
  { value: 'cache', label: '캐시' },
  { value: 'variables', label: '변수' },
  { value: 'modules', label: '모듈' },
  { value: 'scripts', label: '스크립트' },
];

type ChatInspectProps = Pick<OpenChat, 'messages' | 'busy' | 'prompt'> & { chat: string; character: string | null; tab: InspectTab; notes: SendNotes; onTab: (tab: InspectTab) => void; onClose: () => void; onEdit: (side: Side) => void };

// 점검: every tab before a send reads the composer's one next-send result (useSendNotes), never a prompt of its own.
export function ChatInspect({ chat, character, tab, notes, messages, busy, prompt, onTab, onClose, onEdit }: ChatInspectProps) {
  const { store } = useSession();
  const conversation = prompt.kind === 'prompt' ? { id: prompt.prompt.id, blocks: prompt.prompt.value.blocks } : null;
  const editor = (from: From) => editorOf(from, conversation, character, (lore) => store.get('lore', lore)?.parent ?? null);
  const tabs = (
    <Tabs label="점검">
      {TABS.map((each) => (
        <Tab key={each.value} label={each.label} current={tab === each.value} onClick={() => onTab(each.value)} />
      ))}
    </Tabs>
  );
  const ready = (view: (sending: Sending) => ReactNode) =>
    busy ? <Empty variant="section">응답이 끝나면 다시 계산해요.</Empty>
    : notes.sending ? view(notes.sending)
    : notes.sending === null ? <Empty variant="section">지금은 요청을 보낼 수 없어서 계산하지 못했어요.</Empty>
    : <Text variant="note">계산하는 중…</Text>;
  return (
    <SidePanel title="점검" onClose={onClose}>
      <Stack gap="section">
        {tabs}
        {tab === 'request' && ready((sending) => <NextRequest chat={chat} sending={sending} request={notes.request} editor={editor} onEdit={onEdit} />)}
        {tab === 'cache' && <CacheTab cache={notes.cache} messages={messages} busy={busy} editor={editor} onEdit={onEdit} />}
        {tab === 'variables' && <Variables chat={chat} sending={notes.sending} busy={busy} />}
        {tab === 'modules' && ready((sending) => <Modules sending={sending} />)}
        {tab === 'scripts' && <Scripts chat={chat} />}
      </Stack>
    </SidePanel>
  );
}

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

function NextRequest({ chat, sending, request, editor, onEdit }: { chat: string; sending: Sending; request: SendNotes['request']; editor: (from: From) => Side | null; onEdit: (side: Side) => void }) {
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
      return SLOT_NAMES[source.kind];
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

const shownValue = (value: string, truncated: boolean) => (value === '' ? '(빈 값)' : truncated ? `${value}…` : value);

function Variables({ chat, sending, busy }: { chat: string; sending: Sending | null | undefined; busy: boolean }) {
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

const ATTACHED = { settings: '설정', prompt: '프롬프트', character: '캐릭터', persona: '페르소나' } as const;

function moduleTags(module: ModuleContribution): string[] {
  const regex = Object.values(module.regex).reduce((sum, count) => sum + count, 0);
  const fired = module.lore.reduce((sum, entry) => sum + entry.parts.reduce((each, part) => each + part.tokens, 0), 0);
  return [
    ...(module.lore.length ? [`로어북 ${module.lore.length}개 · ${tokens(fired)} 토큰`] : []),
    ...(regex ? [`정규식 ${regex}개`] : []),
    ...(module.triggers.lua ? [`Lua ${module.triggers.lua}개`] : []),
    ...(module.triggers.blocks ? [`트리거 ${module.triggers.blocks}개`] : []),
    ...(module.toggles.length ? [`토글 ${module.toggles.length}개`] : []),
    ...(module.tools.length ? [`도구 ${module.tools.length}개`] : []),
  ];
}

function Modules({ sending }: { sending: Sending }) {
  const session = useSession();
  const [open, setOpen] = useState<string | null>(null);
  const modules = moduleContributions(session, sending.turn.chat, sending.prompt);
  if (modules.length === 0) return <Empty variant="section">이 채팅에서 켜져 있는 모듈이 없어요.</Empty>;
  return (
    <List label="실행되는 모듈">
      {modules.map((module) => (
        <ListItem
          key={module.id}
          title={module.kind === 'module' ? moduleName(module.name) : module.name}
          badge={module.kind === 'character' ? '캐릭터' : undefined}
          description={module.kind === 'character' ? '캐릭터에 들어 있음' : `${module.attached.map(({ kind }) => ATTACHED[kind]).join(' · ')}에서 켬`}
          tags={moduleTags(module)}
          expanded={open === module.id}
          onClick={() => setOpen(open === module.id ? null : module.id)}
          detail={open === module.id && <ModuleDetail module={module} />}
        />
      ))}
    </List>
  );
}

function ModuleDetail({ module }: { module: ModuleContribution }) {
  return (
    <Stack gap="related">
      <Facts
        items={[
          { label: '입력 정규식', value: `${module.regex.input}개` },
          { label: '응답 정규식', value: `${module.regex.output}개` },
          { label: '요청 정규식', value: `${module.regex.process}개` },
          { label: '화면 정규식', value: `${module.regex.display}개` },
        ]}
      />
      {module.lore.length > 0 ? (
        <List label={`${module.name} 로어북`}>
          {module.lore.map((entry) => (
            <ListItem key={entry.id} title={entry.name} aside={entry.parts.length ? tokens(entry.parts.reduce((sum, part) => sum + part.tokens, 0)) : '안 들어감'} />
          ))}
        </List>
      ) : (
        <Text variant="note">이번 요청에서 켜진 로어북 항목이 없어요.</Text>
      )}
    </Stack>
  );
}

const STAGES: Record<string, string> = { load: '처음 실행', onInput: '입력', editInput: '입력 편집', onStart: '시작', editRequest: '요청 편집', editOutput: '응답 편집', onOutput: '응답', editDisplay: '화면 편집', button: '버튼' };

function Scripts({ chat }: { chat: string }) {
  const { scripts, store } = useSession();
  const log = useSyncExternalStore(
    (listener) => scripts.subscribeLog(chat, listener),
    () => scripts.log(chat),
  );
  const [open, setOpen] = useState<string | null>(null);
  const packName = (pack: PackOwner | null) => (pack === null ? null : pack.kind === 'module' ? store.get('module', pack.id)?.value.name : store.get('character', pack.id)?.value.card.name) ?? null;
  const entries = log.entries.map((entry, index) => ({ entry, key: `${entry.at}:${log.omitted + index}` })).reverse();
  return (
    <Section title="실행 기록" help="이 화면에서 실행된 봇 스크립트와 log() 출력 내용이에요. 새로고침하면 사라져요.">
      {entries.length === 0 ? (
        <Empty variant="section">실행된 스크립트가 없어요.</Empty>
      ) : (
        <Stack gap="related">
          <List label="실행 기록">
            {entries.map(({ entry, key }) => (
              <ListItem
                key={key}
                title={`${STAGES[entry.stage] ?? entry.stage} · ${entry.script || packName(entry.pack) || 'Lua'}`}
                badge={entry.errors.length ? '오류' : undefined}
                tags={hookTags(entry)}
                aside={`${ago(entry.at)} · ${Math.round(entry.duration)}ms`}
                expanded={open === key}
                onClick={() => setOpen(open === key ? null : key)}
                detail={open === key && <HookDetail entry={entry} />}
              />
            ))}
          </List>
          {log.omitted > 0 && <Text variant="note">{`오래된 기록 ${log.omitted}개는 빠졌어요.`}</Text>}
        </Stack>
      )}
    </Section>
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
