import { useEffect, useRef, useState } from 'react';
import type { CbsStep } from '../../../engine/cbs/evaluate';
import type { ChatScope } from '../../../engine/render';
import type { Event, ScriptUnit } from '../../../engine/script-api';
import type { LoreOwner } from '../../../model/library';
import { chatNow } from '../../../runtime/chat-context';
import type { TrialRead } from '../../../runtime/evaluation-core';
import type { Trial } from '../../../runtime/scripts';
import { useChats, useSession } from '../../session';
import { Button, Callout, ChoiceGroup, CodeBlock, Facts, Stack, StepList, Text, type CodeAside, type StepRow } from '../../ui';
import { runaway } from '../failure';
import { HookDetail } from '../HookDetail';
import { LUA_EVENTS } from './luaApi';
import { SAMPLE, SAMPLE_NOTE } from './sample';

const LABEL = '시험해 보기';
// The lane name the sample runs on, which no chat id takes.
const SAMPLE_CHAT = 'sample';
const WAIT_MS = 400;

// Whose draft it is, which picks the chats offered: a character's own, the one chat of a chat's lorebook, any chat
// otherwise.
type Owner = LoreOwner | null;

export const cbsTrial = (owner: Owner) => (text: string): CodeAside => ({ label: LABEL, body: (reveal) => <CbsTrial text={text} owner={owner} reveal={reveal} /> });
type LuaUnit = Extract<ScriptUnit, { kind: 'lua' }>;
export const luaTrial = (unit: LuaUnit, owner: Owner) => (code: string): CodeAside => ({ label: LABEL, body: () => <LuaTrial unit={{ ...unit, code }} owner={owner} /> });

// A CBS text's result as the reader sees it; null: its commands ran away and were stopped.
export function CbsResult({ result }: { result: string | null }) {
  return (
    <>
      <Text variant="note">{result === null ? '결과: 출력이 너무 길어서 중단됨' : result ? '결과' : '결과: 빈 텍스트'}</Text>
      {result && <CodeBlock variant="prose">{result}</CodeBlock>}
    </>
  );
}

function TrialChats({ owner, chat, onChange }: { owner: Owner; chat: string | null; onChange: (chat: string | null) => void }) {
  const chats = useChats().filter((summary) => (owner?.kind === 'character' ? summary.chat.character === owner.id : owner?.kind === 'chat' ? summary.id === owner.id : true));
  const where = [{ value: 'sample', label: '예시 채팅' }, ...(chats.length ? [{ value: 'mine', label: '내 채팅' }] : [])];
  return (
    <Stack gap="related">
      <ChoiceGroup label="시험할 채팅" showLabel layout="segmented" options={where} value={chat === null ? 'sample' : 'mine'} onChange={(to) => onChange(to === 'sample' ? null : chats[0]!.id)} />
      {chat === null ? (
        <Text variant="note">{SAMPLE_NOTE}</Text>
      ) : (
        <>
          <ChoiceGroup label="채팅" layout="menu" options={chats.map(({ id, title }) => ({ value: id, label: title }))} value={chat} onChange={onChange} />
          <Text variant="note">채팅은 바뀌지 않아요.</Text>
        </>
      )}
    </Stack>
  );
}

// The chat a draft runs in: the sample, or the chosen chat as it stood when chosen; null while it is read.
function useTrialScope(chat: string | null): ChatScope | 'failed' | null {
  const session = useSession();
  const [read, setRead] = useState<{ chat: string; scope: ChatScope | 'failed' } | null>(null);
  useEffect(() => {
    if (chat === null) return;
    const stop = new AbortController();
    const done = (scope: ChatScope | 'failed') => !stop.signal.aborted && setRead({ chat, scope });
    chatNow(session, chat, stop.signal).then((scope) => done(scope ?? 'failed'), () => done('failed'));
    return () => stop.abort();
  }, [session, chat]);
  return chat === null ? SAMPLE : read?.chat === chat ? read.scope : null;
}

type Reveal = (at: [number, number]) => void;

function CbsTrial({ text, owner, reveal }: { text: string; owner: Owner; reveal: Reveal }) {
  const { store } = useSession();
  const [chat, setChat] = useState<string | null>(null);
  const scope = useTrialScope(chat);
  const [read, setRead] = useState<{ scope: ChatScope; text: string; result: TrialRead | null | 'failed' } | null>(null);
  useEffect(() => {
    if (scope === null || scope === 'failed') return;
    const lane = { asker: 'trial', chat: chat ?? SAMPLE_CHAT } as const;
    const stop = new AbortController();
    const done = (result: TrialRead | null | 'failed') => !stop.signal.aborted && setRead({ scope, text, result });
    const timer = setTimeout(() => {
      store.evaluation.text(lane, scope, text, stop.signal).then((answer) => done('kind' in answer ? null : answer), () => done('failed'));
    }, WAIT_MS);
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [store, chat, scope, text]);
  useEffect(() => () => store.evaluation.forget({ asker: 'trial', chat: chat ?? SAMPLE_CHAT }), [store, chat]);
  const shown = read?.scope === scope ? read : undefined;
  return (
    <Stack gap="related">
      <TrialChats owner={owner} chat={chat} onChange={setChat} />
      {scope === 'failed' ? (
        <Text variant="note">채팅을 열지 못했어요.</Text>
      ) : shown === undefined ? (
        <Text variant="note">계산하는 중…</Text>
      ) : shown.result === 'failed' ? (
        <Text variant="note">결과를 만들지 못했어요.</Text>
      ) : shown.result === null ? (
        <CbsResult result={null} />
      ) : (
        <>
          <CbsResult result={shown.result.read} />
          <CbsSteps text={shown.text} read={shown.result} reveal={reveal} stale={shown.text !== text} />
        </>
      )}
    </Stack>
  );
}

// Each tag's and block's result in the order they ran, as of the text they were read from.
function CbsSteps({ text, read: { steps, omitted }, reveal, stale }: { text: string; read: TrialRead; reveal: Reveal; stale: boolean }) {
  if (steps.length === 0) return null;
  // The editor reads \r\n as one line break.
  const inEditor = (at: number) => at - (text.slice(0, at).split('\r\n').length - 1);
  return (
    <>
      <Text variant="note">{`단계 ${steps.length + omitted}개`}</Text>
      <StepList label="단계" steps={steps.map((step) => shownStep(text, step))} onPick={(index) => !stale && reveal([inEditor(steps[index]!.at), inEditor(steps[index]!.end)])} />
      {omitted > 0 && <Text variant="note">{`단계가 많아서 뒤의 ${omitted}개는 빠졌어요.`}</Text>}
    </>
  );
}

const KEPT = { unknown: '모르는 명령어라 쓴 그대로 남아요.', unsupported: '헤이젤이 지원하지 않는 명령어라 쓴 그대로 남아요.', args: '인자를 읽을 수 없어서 쓴 그대로 남아요.' } as const;

function shownStep(text: string, { at, end, headEnd, depth, result, kept, erased, held, condition }: CbsStep): StepRow {
  const source = text.slice(at, headEnd ?? end);
  if (kept) return { source, result, depth, note: KEPT[kept], tone: 'warn' };
  if (erased) return { source, result, depth, note: '앞에 쓴 글을 지워요.' };
  if (held === undefined) return { source, result, depth };
  const verdict = held ? '맞아요' : '안 맞아요';
  return { source, result, depth, note: condition ? `조건 ${condition.join(' ')} → ${verdict}` : `조건이 ${verdict}`, tone: 'branch' };
}

const EVENTS = { onInput: { kind: 'input' }, onStart: { kind: 'start' }, onOutput: { kind: 'output' } } as const satisfies Record<string, Event>;
type TrialEvent = keyof typeof EVENTS;
const isTrialEvent = (name: string): name is TrialEvent => Object.hasOwn(EVENTS, name);
const EVENT_OPTIONS = LUA_EVENTS.flatMap(({ name, text }) => (isTrialEvent(name) ? [{ value: name, label: name, sub: text }] : []));

type Ran = { code: string; event: TrialEvent; trial: Trial | 'failed' };

function LuaTrial({ unit, owner }: { unit: LuaUnit; owner: Owner }) {
  const { scripts } = useSession();
  const [chat, setChat] = useState<string | null>(null);
  const scope = useTrialScope(chat);
  const [event, setEvent] = useState<TrialEvent>('onOutput');
  const [ran, setRan] = useState<Ran | 'running' | null>(null);
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const run = (on: ChatScope) => {
    running.current?.abort();
    const stop = (running.current = new AbortController());
    const at = { code: unit.code, event };
    setRan('running');
    scripts.trial(chat ?? SAMPLE_CHAT, on, unit, EVENTS[event], stop.signal).then(
      (trial) => !stop.signal.aborted && setRan({ ...at, trial }),
      () => !stop.signal.aborted && setRan({ ...at, trial: 'failed' }),
    );
  };
  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    running.current?.abort();
    setRan(null);
    set(value);
  };
  return (
    <Stack gap="related">
      <TrialChats owner={owner} chat={chat} onChange={reset(setChat)} />
      <ChoiceGroup label="실행할 때" layout="menu" options={EVENT_OPTIONS} value={event} onChange={reset(setEvent)} />
      {scope === 'failed' ? (
        <Text variant="note">채팅을 열지 못했어요.</Text>
      ) : (
        <Button disabled={scope === null || ran === 'running'} onClick={() => scope && run(scope)}>
          {ran === 'running' ? '실행하는 중…' : '시험 실행'}
        </Button>
      )}
      {ran !== null && ran !== 'running' && <LuaRan ran={ran} stale={ran.code !== unit.code} />}
    </Stack>
  );
}

function LuaRan({ ran: { event, trial }, stale }: { ran: Ran; stale: boolean }) {
  if (trial === 'failed') return <Callout tone="warn">시험 실행하지 못했어요.</Callout>;
  const { outcome, said, asked, calls, loreRanAway } = trial;
  const count = (label: string, length: number, unit = '개') => (length ? [{ label, value: `${length}${unit}` }] : []);
  const facts = [
    ...(outcome.stop ? [{ label: '보내기', value: '멈춰요' }] : []),
    ...(said.length ? [{ label: '띄울 알림', value: said.map(({ text }) => text).join(' · ') }] : []),
    ...count('물어볼 질문', asked.length),
    ...count('추가할 메시지', outcome.added.length),
    ...count('고칠 메시지', outcome.edits.length),
    ...count('지울 메시지', outcome.removed.length),
    ...count('채팅 로어북에 쓸 항목', outcome.lore.length),
    ...count('부르지 않은 모델', calls.model, '번'),
    ...count('만들지 않은 임베딩', calls.embed, '번'),
    ...count('바꾸지 않은 배경', calls.background, '번'),
  ];
  const traced = outcome.trace?.entries ?? [];
  return (
    <Stack gap="related">
      {stale && <Text variant="note">코드가 바뀌었어요. 다시 실행하면 지금 코드로 시험해요.</Text>}
      {!outcome.handled && <Text variant="note">{`이 코드에는 ${event} 함수가 없어요.`}</Text>}
      {loreRanAway && <Callout tone="warn">{runaway('로어북을 스크립트에 넘기기 전에')}</Callout>}
      {facts.length > 0 && <Facts items={facts} />}
      {traced.map((entry, index) => (
        <HookDetail key={index} entry={entry} />
      ))}
      {outcome.handled && facts.length === 0 && traced.every((entry) => !entry.writes.length && !entry.logs.length && !entry.errors.length) && <Text variant="note">바뀌는 것이 없어요.</Text>}
    </Stack>
  );
}
