import { MoreHorizontal, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { emptyMemory, type Fact, type MemorySettings, type Thread } from '../../model/memory';
import { memorySetup, memoryView, removeFact, removeThread, setChatMemory, setFact, setThread, type MemoryView } from '../../runtime/memory';
import { tokenizer } from '../../runtime/tokenizer';
import { describeMemoryFailure } from '../common/failure';
import { MemoryFields, settingsOf } from '../common/MemoryFields';
import { tokens } from '../common/receipt';
import { filled, typedText } from '../common/typed';
import { useAutosave } from '../common/useAutosave';
import { inSettings } from '../common/words';
import { useChatMemory, usePrompts, useRemembering, useSession, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Button, Callout, ConfirmDialog, Empty, Facts, IconButton, List, ListItem, Menu, MenuItem, Row, Section, SidePanel, Stack, Text, TextField } from '../ui';
import { ChatMemoryRecord } from './ChatMemoryRecord';
import { factGroups, recordScene, recordTitle, spanOf, STATUS_WORDS } from './memory';
import type { OpenChat } from './useChat';

const NO_MEMORY = emptyMemory();

// What memoryView says of the chat, worked out again when anything it reads may have changed; while a reply streams
// the last answer stands, since every chunk changes the messages.
function useView(id: string, busy: boolean, inputs: unknown[]): MemoryView | null {
  const session = useSession();
  const [view, setView] = useState<MemoryView | null>(null);
  useEffect(() => {
    if (busy) return;
    let live = true;
    void tokenizer().then(
      (countTokens) => live && setView(memoryView(session, id, countTokens)),
      () => live && setView(null),
    );
    return () => {
      live = false;
    };
  }, [id, busy, ...inputs]);
  return view;
}

// 장기 기억 beside the chat (design §6.2): whether it is being written, the state, the open threads and the records in
// chat order, each opening in the list's place, and the chat's memory settings. Without memoryView's answer nothing is
// said about what is sent: no status, no tokens, no missing slot.
export function ChatMemory({ id, record, chat }: { id: string; record: string | null; chat: OpenChat }) {
  const session = useSession();
  const { store } = session;
  const toast = useToast();
  const memory = useChatMemory(id) ?? NO_MEMORY;
  const settings = useSettings();
  const prompts = usePrompts();
  const { running, failed } = useRemembering();
  const { item, messages, prompt, busy, actions } = chat;
  // The panel opens only from a saved chat, whose item is there.
  const own = item!.chat;
  const setup = memorySetup(store, own);
  const view = useView(id, busy, [memory, own, messages, settings, prompts]);
  const [rebuilding, setRebuilding] = useState(false);
  const [resets, setResets] = useState(0);
  const save = useAutosave<MemorySettings>(`chat-memory:${id}`, (patch) => {
    const current = store.get('chat', id);
    if (!current) return Promise.resolve({ ok: false, error: 'gone' } as const);
    return setChatMemory(store, id, { ...settingsOf(memorySetup(store, current.value)), ...patch });
  });

  const opened = record === null ? undefined : memory.records.find((each) => each.id === record);
  if (opened) return <ChatMemoryRecord chat={id} record={opened} status={view?.records.get(opened.id) ?? null} stale={view?.stale.get(opened.id) ?? null} messages={messages} actions={actions} />;

  async function revert() {
    if (!(await save.flush())) return;
    const done = await setChatMemory(store, id, null);
    if (!done.ok) return toast.failed(done, '되돌리지 못했어요.');
    setResets((count) => count + 1);
  }

  const writing = running.get(id);
  const failure = failed.get(id);
  const live = memory.records.filter((each) => !each.forgotten);
  const pinnedOver = memory.records.some((each) => each.pinned && view?.records.get(each.id) === 'over');
  const more = (
    <Menu place="below-end" label="장기 기억 더 보기" trigger={(opener) => <IconButton icon={MoreHorizontal} label="장기 기억 더 보기" size="sm" {...opener} />}>
      <MenuItem label="원문에서 전부 다시 만들기" onClick={() => setRebuilding(true)} />
    </Menu>
  );

  return (
    <SidePanel title="장기 기억" actions={more} onClose={actions.closePanel}>
      {writing ? (
        <Text variant="note">{`기억을 정리하는 중이에요 · ${writing.model} · 남은 호출 ${writing.left}개`}</Text>
      ) : (
        failure && (
          <Callout tone="warn" action={{ label: '다시 시도', onClick: () => session.memory.retry(id) }}>
            {`기억을 정리하지 못했어요. ${describeMemoryFailure(failure)}`}
          </Callout>
        )
      )}
      {!setup.on && <Text variant="note">이 채팅은 장기 기억을 쓰지 않아요.</Text>}
      {setup.on && view && !view.slot && (
        <Callout tone="warn" action={prompt.kind === 'prompt' ? { label: '프롬프트 열기', onClick: () => actions.side({ kind: 'prompts', id: prompt.prompt.id, pane: null }) } : undefined}>
          이 채팅의 프롬프트에 장기 기억 자리가 없어서 기억을 보내지 않아요.
        </Callout>
      )}
      {view && (
        <Stack gap="related">
          <Facts
            items={[
              { label: '기억한 메시지', value: `${view.covered}개` },
              { label: '정리를 기다리는 메시지', value: `${view.waiting}개` },
              { label: '보내는 기억', value: `약 ${tokens(view.tokens.used)} / ${tokens(view.tokens.budget)} 토큰` },
            ]}
          />
          {view.tokens.budget < setup.budget && <Text variant="note">{`지금 모델에 맞춰 기록을 ${tokens(view.tokens.budget)} 토큰까지만 보내요.`}</Text>}
        </Stack>
      )}

      <Section
        level={3}
        title="상태"
        note={view ? `약 ${tokens(view.tokens.state)} / ${tokens(view.tokens.stateLimit)} 토큰` : undefined}
        hint="관계와 말투, 이름, 가진 것, 다친 곳, 있는 곳, 누가 무엇을 아는지의 지금 값이에요. 늘 프롬프트에 들어가요."
      >
        {view && view.tokens.state > view.tokens.stateLimit && <Callout tone="warn">상태가 한도를 넘었어요. 앱이 알아서 줄이지 않으니, 필요 없는 줄을 지우거나 줄여 주세요.</Callout>}
        {factGroups(memory.state).flatMap(({ facts }) => facts.map((fact) => <FactRow key={`${fact.about}\n${fact.field}`} chat={id} fact={fact} />))}
        {memory.state.length === 0 && <Empty variant="section">아직 상태가 없어요. 기록을 정리하면서 채워져요.</Empty>}
        <NewFact chat={id} />
      </Section>

      <Threads chat={id} threads={memory.threads} />

      <Section level={3} title="기록" note={`${live.length}개`}>
        {pinnedOver && <Callout tone="warn">항상 넣기한 기록이 기록에 쓸 양을 넘어서, 넘은 기록은 보내지 않아요. 항상 넣기를 풀거나 기록에 쓸 양을 늘려 주세요.</Callout>}
        {memory.records.length ? (
          <List label="기록">
            {memory.records.map((each) => {
              const status = view?.records.get(each.id);
              return (
                <ListItem
                  key={each.id}
                  title={recordTitle(each)}
                  description={[spanOf(each.sources, messages).words, recordScene(each)].filter(Boolean).join(' · ')}
                  tags={[...(each.pinned ? ['항상 넣기'] : []), ...(status && status !== 'sent' ? [STATUS_WORDS[status]] : [])]}
                  onClick={() => actions.memory(each.id)}
                />
              );
            })}
          </List>
        ) : (
          <Empty variant="section">{setup.on ? '아직 기록이 없어요. 대화가 길어지면 오래된 부분부터 기록으로 정리해요.' : '기록이 없어요.'}</Empty>
        )}
      </Section>

      <Section
        level={3}
        title="설정"
        note={setup.own ? '이 채팅만 따로' : '기본값'}
        hint={`바꾸면 이 채팅만 따로 정해요. 기본값은 ${inSettings('prompts')}에서 정해요.`}
        action={
          setup.own && (
            <Button variant="link" size="xs" onClick={() => void revert()}>
              기본값으로 되돌리기
            </Button>
          )
        }
      >
        <MemoryFields key={resets} value={{ ...settingsOf(setup), ...save.unsaved }} onChange={save.change} />
      </Section>

      {rebuilding && (
        <ConfirmDialog
          title="원문에서 전부 다시 만들까요?"
          confirm="다시 만들기"
          icon={RotateCcw}
          onConfirm={() => {
            session.memory.rebuild(id, null);
            setRebuilding(false);
          }}
          onClose={() => setRebuilding(false)}
        >
          지금 기억을 남아 있는 메시지로 처음부터 다시 정리해요. 긴 채팅은 호출이 많이 들고, 되돌릴 수 없어요.
        </ConfirmDialog>
      )}
    </SidePanel>
  );
}

// One fact, its value edited in place; whom it concerns and which field stay, so a rename is a delete and an add.
function FactRow({ chat, fact }: { chat: string; fact: Fact }) {
  const store = useStore();
  const toast = useToast();
  const save = useAutosave<Pick<Fact, 'value'>>(`fact:${chat}:${fact.about}\n${fact.field}`, (patch) => setFact(store, chat, { ...fact, ...patch, record: null }, fact));
  const [typed, setTyped] = useState<string>();
  const value = typedText(typed, filled, save.unsaved.value ?? fact.value, String);
  const name = `${fact.about} · ${fact.field}`;

  function type(next: string) {
    setTyped(next);
    save.change({ value: next }, next.trim() !== '');
  }

  async function remove() {
    const removed = await save.remove(() => removeFact(store, chat, fact));
    if (!removed) return;
    if (!removed.ok) return toast.failed(removed, '지우지 못했어요.');
    toast.undoable(`‘${name}’을(를) 지웠어요`, () => void setFact(store, chat, removed.data, null).then((done) => done.ok || toast.failed(done, '되돌리지 못했어요.')));
  }

  return (
    <TextField
      label={name}
      value={value}
      onChange={type}
      error={value.trim() ? undefined : '값을 적어 주세요. 필요 없으면 지워 주세요.'}
      action={<IconButton icon={Trash2} label={`${name} 지우기`} size="sm" onClick={() => void remove()} />}
    />
  );
}

function NewFact({ chat }: { chat: string }) {
  const store = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Omit<Fact, 'record'> | null>(null);
  if (!draft) {
    return (
      <Row kind="actions">
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setDraft({ about: '', field: '', value: '' })}>
          상태 추가
        </Button>
      </Row>
    );
  }
  const ready = draft.about.trim() !== '' && draft.field.trim() !== '' && draft.value.trim() !== '';
  async function add() {
    const done = await setFact(store, chat, { ...draft!, record: null }, null);
    if (!done.ok) return toast.failed(done, '저장하지 못했어요.');
    setDraft(null);
  }
  return (
    <Stack gap="related">
      <TextField label="누구·무엇" placeholder="예: 이름이나 장소" value={draft.about} onChange={(about) => setDraft({ ...draft, about })} />
      <TextField label="항목" placeholder="예: 부르는 말" value={draft.field} onChange={(field) => setDraft({ ...draft, field })} />
      <TextField label="값" value={draft.value} onChange={(value) => setDraft({ ...draft, value })} />
      <Row kind="actions">
        <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
          취소
        </Button>
        <Button size="sm" disabled={!ready} onClick={() => void add()}>
          추가
        </Button>
      </Row>
    </Stack>
  );
}

// Open threads in the order they were opened. One added here is a draft on the page until its first words are saved,
// and stops being one then: a saved thread deleted later must not come back as the blank it started from.
function Threads({ chat, threads }: { chat: string; threads: Thread[] }) {
  const [drafts, setDrafts] = useState<Thread[]>([]);
  const unsaved = drafts.filter((draft) => !threads.some(({ id }) => id === draft.id));
  if (unsaved.length !== drafts.length) setDrafts(unsaved);
  const shown = [...threads, ...unsaved];
  return (
    <Section level={3} title="열린 이야기" note={`${threads.length}개`} hint="약속, 복선, 아직 끝나지 않은 일이에요. 기록이 닫을 때까지 늘 프롬프트에 들어가서, 캐릭터가 먼저 꺼낼 수 있어요.">
      {shown.map((thread, index) => (
        <ThreadRow
          key={thread.id}
          chat={chat}
          thread={thread}
          name={`열린 이야기 ${index + 1}`}
          onDrop={() => setDrafts((current) => current.filter(({ id }) => id !== thread.id))}
        />
      ))}
      {shown.length === 0 && <Empty variant="section">열린 이야기가 없어요.</Empty>}
      <Row kind="actions">
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setDrafts((current) => [...current, { id: crypto.randomUUID(), text: '', opened: null }])}>
          열린 이야기 추가
        </Button>
      </Row>
    </Section>
  );
}

// onDrop: it is a draft no more, deleted before anything of it was saved.
function ThreadRow({ chat, thread, name, onDrop }: { chat: string; thread: Thread; name: string; onDrop: () => void }) {
  const store = useStore();
  const toast = useToast();
  const save = useAutosave<Pick<Thread, 'text'>>(`thread:${chat}:${thread.id}`, (patch) => setThread(store, chat, { ...thread, ...patch }));
  const [typed, setTyped] = useState<string>();
  const text = typedText(typed, filled, save.unsaved.text ?? thread.text, String);

  function type(next: string) {
    setTyped(next);
    save.change({ text: next }, next.trim() !== '');
  }

  async function remove() {
    const removed = await save.remove(() => removeThread(store, chat, thread.id));
    if (!removed) return;
    if (!removed.ok) return removed.error === 'gone' ? onDrop() : toast.failed(removed, '지우지 못했어요.');
    toast.undoable('열린 이야기를 지웠어요', () => void setThread(store, chat, removed.data).then((done) => done.ok || toast.failed(done, '되돌리지 못했어요.')));
  }

  return (
    <TextField
      label={name}
      lines={2}
      value={text}
      onChange={type}
      action={<IconButton icon={Trash2} label={`${name} 지우기`} size="sm" onClick={() => void remove()} />}
    />
  );
}
