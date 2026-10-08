import { MoreHorizontal, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { emptyMemory, type Fact, type MemorySettings, type Thread } from '../../model/memory';
import { memorySetup } from '../../runtime/memory-read';
import { memoryView, type MemoryView } from '../../runtime/memory-view';
import { removeFact, removeThread, setChatMemory, setFact, setThread } from '../../runtime/memory';
import { describeMemoryFailure } from '../common/failure';
import { MemoryFields, settingsOf } from '../common/MemoryFields';
import { tokens } from '../common/receipt';
import { filled, typedText } from '../common/typed';
import { useAutosave } from '../common/useAutosave';
import { CHAPTER, inSettings } from '../common/words';
import { useChatMemory, usePrompts, useRemembering, useSession, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Button, Callout, ConfirmDialog, Empty, Facts, IconButton, List, Menu, MenuItem, Row, Section, SidePanel, Stack, Text, TextField } from '../ui';
import { ChatMemoryRecord, MemoryRow } from './ChatMemoryRecord';
import { factGroups, memoryRows, MessagePositions } from './memory';
import type { OpenChat } from './useChat';

const NO_MEMORY = emptyMemory();

// While a reply streams the last answer stands, since every chunk changes the messages.
function useView(id: string, busy: boolean, inputs: unknown[]): MemoryView | null {
  const session = useSession();
  const [view, setView] = useState<MemoryView | null>(null);
  useEffect(() => {
    if (busy) return;
    let live = true;
    void memoryView(session, id).then(
      (view) => live && setView(view),
      () => live && setView(null),
    );
    return () => {
      live = false;
    };
  }, [id, busy, ...inputs]);
  return view;
}

// 장기 기억 (design §6.2). Without memoryView's answer nothing is said about what is sent: no status, no tokens, no missing
// slot.
export function ChatMemory({ id, record, chat }: { id: string; record: string | null; chat: OpenChat }) {
  const session = useSession();
  const { store } = session;
  const toast = useToast();
  const memory = useChatMemory(id) ?? NO_MEMORY;
  const settings = useSettings();
  const prompts = usePrompts();
  const { running, failed, chapterFailed } = useRemembering();
  const { item, messages, prompt, busy, actions } = chat;
  const [messagePositions] = useState(() => new MessagePositions());
  const positions = messagePositions.read(messages);
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

  const opened = record === null ? undefined : [...memory.records, ...memory.chapters].find((each) => each.id === record);
  if (opened) return <ChatMemoryRecord chat={id} item={opened} memory={memory} view={view} positions={positions} actions={actions} />;

  async function revert() {
    if (!(await save.flush())) return;
    void setChatMemory(store, id, null).then((done) => done.ok || toast.failed(done, '되돌리지 못했어요.'));
    setResets((count) => count + 1);
  }

  const writing = running.get(id);
  const failure = failed.get(id);
  const unchaptered = chapterFailed.get(id);
  const live = memory.records.filter((each) => !each.forgotten);
  const more = (
    <Menu place="below-end" label="장기 기억 더 보기" trigger={(opener) => <IconButton icon={MoreHorizontal} label="장기 기억 더 보기" size="sm" {...opener} />}>
      <MenuItem label="원문에서 전부 다시 만들기" onClick={() => setRebuilding(true)} />
    </Menu>
  );

  return (
    <SidePanel title="장기 기억" actions={more} onClose={actions.closePanel}>
      {writing ? (
        <Text variant="note">{`기억 정리 중 · ${writing.model} · 남은 호출 ${writing.left}개`}</Text>
      ) : (
        failure && (
          <Callout tone="warn" action={{ label: '다시 시도', onClick: () => session.memory.retry(id) }}>
            {`기억을 정리하지 못했어요. ${describeMemoryFailure(failure)}`}
          </Callout>
        )
      )}
      {!writing && unchaptered && (
        <Callout tone="warn" action={{ label: '다시 시도', onClick: () => session.memory.retry(id) }}>
          {`${CHAPTER}를 만들지 못했어요. ${describeMemoryFailure(unchaptered)}`}
        </Callout>
      )}
      {!setup.on && <Text variant="note">이 채팅은 장기 기억을 쓰지 않아요.</Text>}
      {setup.on && view && !view.slot && (
        <Callout tone="warn" action={prompt.kind === 'prompt' ? { label: '프롬프트 열기', onClick: () => actions.side({ kind: 'prompts', id: prompt.prompt.id, pane: null }) } : undefined}>
          프롬프트에 장기 기억 블록이 없어서 기억을 보내지 않아요.
        </Callout>
      )}
      {view && (
        <Stack gap="related">
          <Facts
            items={[
              { label: '기억한 메시지', value: `${view.covered}개` },
              { label: '정리를 기다리는 메시지', value: `${view.waiting}개` },
              { label: '기억 사용량', value: `약 ${tokens(view.tokens.used)} / ${tokens(view.tokens.budget)} 토큰` },
            ]}
          />
        </Stack>
      )}

      <Section
        level={3}
        title="상태"
        note={view ? `약 ${tokens(view.tokens.state)} / ${tokens(view.tokens.stateLimit)} 토큰` : undefined}
        hint="관계, 호칭, 소지품, 부상, 위치 같은 현재 상태예요."
      >
        {view && view.tokens.state > view.tokens.stateLimit && <Callout tone="warn">상태가 한도를 넘었어요. 필요 없는 상태를 삭제하거나 줄여 주세요.</Callout>}
        {factGroups(memory.state).flatMap(({ facts }) => facts.map((fact) => <FactRow key={`${fact.about}\n${fact.field}`} chat={id} fact={fact} />))}
        {memory.state.length === 0 && <Empty variant="section">상태가 없어요.</Empty>}
        <NewFact chat={id} />
      </Section>

      <Threads chat={id} threads={memory.threads} />

      <Section level={3} title="기록" note={`${live.length}개`}>
        {view?.crowded && <Callout tone="warn">고정한 기록이 한도를 넘어 일부를 보내지 않아요. 고정을 풀거나 한도를 늘려 주세요.</Callout>}
        {memory.records.length ? (
          <List label="기록">
            {memoryRows(memory).map((each) => (
              <MemoryRow key={each.id} item={each} view={view} positions={positions} onOpen={() => actions.memory(each.id)} />
            ))}
          </List>
        ) : (
          <Empty variant="section">기록이 없어요.</Empty>
        )}
      </Section>

      <Section
        level={3}
        title="설정"
        note={setup.own ? '이 채팅만' : '기본값'}
        hint={`기본값은 ${inSettings('prompts')}에서 바꿀 수 있어요.`}
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
          남아 있는 메시지로 기억을 처음부터 다시 정리해요. 긴 채팅은 요금이 많이 들 수 있고, 되돌릴 수 없어요.
        </ConfirmDialog>
      )}
    </SidePanel>
  );
}

// Whom a fact concerns and which field stay, so a rename is a delete and an add.
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
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable(`'${name}'을(를) 삭제했어요`, () => void setFact(store, chat, removed.data, null).then((done) => done.ok || toast.failed(done, '되돌리지 못했어요.')));
  }

  return (
    <TextField
      label={name}
      value={value}
      onChange={type}
      error={value.trim() ? undefined : '값을 입력해 주세요.'}
      action={<IconButton icon={Trash2} label={`${name} 삭제`} size="sm" onClick={() => void remove()} />}
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
  function add() {
    void setFact(store, chat, { ...draft!, record: null }, null).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'));
    setDraft(null);
  }
  return (
    <Stack gap="related">
      <TextField label="대상" placeholder="예: 이름이나 장소" value={draft.about} onChange={(about) => setDraft({ ...draft, about })} />
      <TextField label="항목" placeholder="예: 호칭" value={draft.field} onChange={(field) => setDraft({ ...draft, field })} />
      <TextField label="값" value={draft.value} onChange={(value) => setDraft({ ...draft, value })} />
      <Row kind="actions">
        <Button variant="secondary" size="sm" onClick={() => setDraft(null)}>
          취소
        </Button>
        <Button size="sm" disabled={!ready} onClick={add}>
          추가
        </Button>
      </Row>
    </Stack>
  );
}

// One added here is a draft on the page until its first words are saved, and stops being one then: a saved thread
// deleted later must not come back as the blank it started from.
function Threads({ chat, threads }: { chat: string; threads: Thread[] }) {
  const [drafts, setDrafts] = useState<Thread[]>([]);
  const unsaved = drafts.filter((draft) => !threads.some(({ id }) => id === draft.id));
  if (unsaved.length !== drafts.length) setDrafts(unsaved);
  const shown = [...threads, ...unsaved];
  return (
    <Section level={3} title="미해결 사건" note={`${threads.length}개`} hint="약속, 복선처럼 끝나지 않은 일이에요.">
      {shown.map((thread, index) => (
        <ThreadRow
          key={thread.id}
          chat={chat}
          thread={thread}
          name={`미해결 사건 ${index + 1}`}
          onDrop={() => setDrafts((current) => current.filter(({ id }) => id !== thread.id))}
        />
      ))}
      {shown.length === 0 && <Empty variant="section">미해결 사건이 없어요.</Empty>}
      <Row kind="actions">
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setDrafts((current) => [...current, { id: crypto.randomUUID(), text: '', opened: null }])}>
          미해결 사건 추가
        </Button>
      </Row>
    </Section>
  );
}

// onDrop: it is a draft no more, deleted before anything of it was saved.
function ThreadRow({ chat, thread, name, onDrop }: { chat: string; thread: Thread; name: string; onDrop: () => void }) {
  const store = useStore();
  const toast = useToast();
  const save = useAutosave<Pick<Thread, 'text'>>(`thread:${chat}:${thread.id}`, (patch) => setThread(store, chat, { ...thread, ...patch }, true));
  const [typed, setTyped] = useState<string>();
  const text = typedText(typed, filled, save.unsaved.text ?? thread.text, String);

  function type(next: string) {
    setTyped(next);
    save.change({ text: next }, next.trim() !== '');
  }

  async function remove() {
    const removed = await save.remove(() => removeThread(store, chat, thread.id));
    if (!removed) return;
    if (!removed.ok) return removed.error === 'gone' ? onDrop() : toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable('미해결 사건을 삭제했어요', () => void setThread(store, chat, removed.data, false).then((done) => done.ok || toast.failed(done, '되돌리지 못했어요.')));
  }

  return (
    <TextField
      label={name}
      lines={2}
      value={text}
      onChange={type}
      action={<IconButton icon={Trash2} label={`${name} 삭제`} size="sm" onClick={() => void remove()} />}
    />
  );
}
