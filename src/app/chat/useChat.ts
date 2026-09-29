import { useEffect, useRef, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import { unused } from '../../engine/pipeline';
import { shown, type Chat, type ChatItem } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { chatModel, setChatModel } from '../../runtime/assignment';
import { resetToggles, setToggle } from '../../runtime/characters';
import {
  branchChat,
  editMessage,
  removeChat,
  removeMessage,
  renameChat,
  restoreChat,
  restoreMessage,
  selectVersion,
  setChatNote,
  setChatPersona,
  setChatPrompt,
  startChat,
} from '../../runtime/chat-log';
import { chatPersona } from '../../runtime/personas';
import { chatPrompt } from '../../runtime/prompts';
import { withTurn, type Shown } from '../../runtime/talk';
import { blocked, displayChat, takeTurn, togglesOf, type Blocked, type Target, type TurnFailure } from '../../runtime/turn';
import { describeTurnFailure } from '../common/failure';
import { describeUnused } from '../common/unused';
import { useSession, useTurn } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { useMenuHandle } from '../ui';
import { useDraft } from './useDraft';
import { toggleRows } from './toggles';
import { useFollow } from './useFollow';

type Own = 'prompt' | 'persona' | 'note';
const WRITE_OWN = { prompt: setChatPrompt, persona: setChatPersona, note: setChatNote };

// The failures a chip fixes, shown by the composer for as long as they hold rather than as a toast.
const BLOCKING = new Set<TurnFailure['kind']>(['no-model', 'model-gone', 'prompt-missing', 'persona-missing']);
const blocks = (failure: TurnFailure): failure is Blocked => BLOCKING.has(failure.kind);

export type OpenChat = ReturnType<typeof useChat>;
// Every part of the chat screen acts through this one object, so a new message action (이어 쓰기,
// 갈라지기) is a new entry here rather than a new prop on each part between this and ChatMessage.
export type ChatActions = OpenChat['actions'];

// design F3. item null is a new chat, saved with its first message; shelf is its character, or null
// for 캐릭터 없이.
export function useChat(item: ChatItem | null, shelf: CharacterShelf<ChatItem> | null) {
  const session = useSession();
  const { store, talk } = session;
  const turn = useTurn();
  const toast = useToast();
  const id = item?.id ?? null;
  // The id a new chat is shown under and then saved under, so its greeting's pick and rollp tags keep their rolls.
  const [newId] = useState(() => crypto.randomUUID());
  // A new chat's own model, prompt, persona and note, saved with it on the first send.
  const [unsaved, setUnsaved] = useState<Omit<Chat, 'title' | 'character'>>({ models: {} });
  const chat: Chat = item?.chat ?? { title: null, character: shelf?.id ?? null, ...unsaved };
  const route = chatModel(store, chat);
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const toggles = toggleRows(togglesOf(store, chat, prompt), prompt.kind === 'prompt' ? prompt.prompt.value.toggles.length : 0);
  const card = shelf?.character.card ?? null;
  const [greeting, setGreeting] = useState(0);
  const [openedAt] = useState(() => Date.now());
  // A blank greeting keeps its place in the card, but a chat never opens on nothing.
  const greetings = card?.greetings.filter((text) => text.trim()) ?? [];
  // The ids the greetings are saved under, so their random tags roll the same before and after the first send.
  const [openingIds] = useState(() => greetings.map(() => crypto.randomUUID()));
  const opening: Shown | null =
    item === null && card && greetings.length > 0
      ? {
          id: 'opening',
          role: 'assistant',
          at: openedAt,
          versions: greetings.map((text, index) => ({ id: openingIds[index]!, text, receipt: null, edited: false, at: openedAt })),
          selected: greeting,
          live: null,
        }
      : null;
  const messages: Shown[] = opening ? [opening] : withTurn(item?.messages ?? [], turn, id ?? '');
  const texts = displayChat(session, id ?? newId, chat, messages);
  const busy = turn !== null;
  const streaming = busy && turn.chat === id;
  const last = messages.at(-1);

  const draft = useDraft(id, chat.character);
  const { follow: toBottom, ...scroll } = useFollow(messages.length, streaming);
  const [dialog, setDialog] = useState<'keys' | 'rename' | 'reading' | null>(null);
  const modelMenu = useMenuHandle();
  const promptMenu = useMenuHandle();
  const personaMenu = useMenuHandle();
  // 정보 and 토글 take the same place beside the story, so one closes the other.
  const [panel, setPanel] = useState<{ kind: 'info'; id: string | null } | { kind: 'toggles' } | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [branching, setBranching] = useState(false);
  // Set when a send or a reply was stopped before the network; the composer then shows what stops the chat now,
  // so a fix made anywhere clears it.
  const [stopped, setStopped] = useState(false);
  const problem = stopped ? blocked(session, chat) : null;

  // A reply starting here while 정보 is open shows its own information.
  const replyTarget = streaming ? (turn.reply.message ?? turn.reply.id) : null;
  useEffect(() => {
    if (replyTarget) setPanel((current) => (current?.kind === 'info' ? { kind: 'info', id: replyTarget } : current));
  }, [replyTarget]);

  function report(failure: TurnFailure | null) {
    if (!failure) return;
    if (blocks(failure)) return setStopped(true);
    toast.show(describeTurnFailure(failure), failure.kind === 'unsaved' ? { label: '다시 저장', onClick: () => void talk.saveAgain().then(report) } : undefined);
  }

  // Back to the foot of the story, which also puts away tools a tap pinned open.
  function follow() {
    toBottom();
    setPinned(null);
  }

  async function send() {
    const text = draft.text.trim();
    if (!text || busy) return;
    await Promise.all(writes.current);
    if (blocked(session, chat)) return setStopped(true);
    setStopped(false);
    draft.set('');
    follow();
    let chatId = id;
    if (chatId === null) {
      const started = await startChat(store, newId, chat, opening && { ids: opening.versions.map((version) => version.id), texts: opening.versions.map((version) => version.text), selected: opening.selected });
      if (!started.ok) {
        draft.set(text);
        toast.failed(started.failure, started.step === 'chat' ? '채팅을 만들지 못했어요.' : '첫인사를 저장하지 못했어요.');
        return;
      }
      chatId = newId;
      navigate({ kind: 'chat', id: chatId }, { replace: true });
    }
    const failure = await takeTurn(session, chatId, { kind: 'send', text });
    // Only an unsaved reply means the user's message was saved.
    if (failure && failure.kind !== 'unsaved') draft.putBack(chatId, text);
    report(failure);
  }

  function ask(target: Target) {
    if (!id || busy) return;
    follow();
    void takeTurn(session, id, target).then(report);
  }

  function select(message: Shown, index: number) {
    if (!id) return;
    void selectVersion(store, id, message.id, message.versions[index]!.id).then((saved) => saved.ok || toast.failed(saved));
  }

  // On the greeting of a chat not started yet, a step picks which greeting it opens on.
  function swipe(message: Shown, step: -1 | 1) {
    if (busy) return;
    const next = message.selected + step;
    if (message === opening) {
      if (next >= 0 && next < message.versions.length) setGreeting(next);
      return;
    }
    if (next >= 0 && next < message.versions.length) select(message, next);
    else if (step === 1 && message === last) ask({ kind: 'regenerate', message: message.id });
  }

  async function saveEdit(message: Shown, andReply: boolean) {
    if (!id || !editing) return;
    const saved = await editMessage(store, id, message, editing.text);
    if (!saved.ok) return toast.failed(saved);
    setEditing(null);
    if (andReply && last && last.role === 'assistant') ask({ kind: 'regenerate', message: last.id });
  }

  async function remove(message: Shown) {
    if (!id) return;
    const chatId = id;
    const saved = await removeMessage(store, chatId, message.id);
    if (!saved.ok) return toast.failed(saved);
    toast.undoable('메시지를 지웠어요', () => void restoreMessage(store, chatId, message.id));
  }

  // The copy is saved one entry after another (runtime/chat-log branchChat), so a long chat takes a while.
  async function branch(message: Shown) {
    if (!item || branching) return;
    setBranching(true);
    toast.show('갈라진 채팅을 만드는 중이에요…');
    const made = await branchChat(store, item, message.id);
    setBranching(false);
    if (!made.ok) return toast.failed(made, '갈라진 채팅을 만들지 못했어요.');
    navigate({ kind: 'chat', id: made.data });
    toast.show('여기서 갈라진 새 채팅을 만들었어요');
  }

  async function drop() {
    if (!item) return;
    if (streaming) talk.stop();
    const removed = await removeChat(store, item.id);
    if (!removed.ok) return toast.failed(removed);
    const stored = removed.data;
    navigate({ kind: 'shelf', character: stored.value.character });
    toast.undoable('채팅을 지웠어요', () => void restoreChat(store, stored).then((saved) => saved.ok && navigate({ kind: 'chat', id: stored.id })));
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.show('복사했어요'),
      () => toast.show('복사하지 못했어요. 브라우저가 클립보드를 막았어요.'),
    );
  }

  // A send waits for these, so a model, note or toggle changed just before it reaches that turn: the turn reads the
  // store, which takes a write only once the server has it.
  const writes = useRef(new Set<Promise<unknown>>());
  function track<T>(write: Promise<T>): Promise<T> {
    const done = () => writes.current.delete(write);
    writes.current.add(write);
    write.then(done, done);
    return write;
  }

  function pickModel(ref: ModelRef) {
    if (!id) {
      setUnsaved({ ...unsaved, models: { ...unsaved.models, main: ref } });
      return;
    }
    void track(setChatModel(store, id, ref)).then((saved) => saved.ok || toast.failed(saved));
  }

  // null: follow the default again (design §4.2, §4.3). A new chat holds it until its first send.
  async function setOwn(field: Own, value: string | null): Promise<void> {
    if (!id) {
      setUnsaved((current) => {
        const next = { ...current };
        if (value === null) delete next[field];
        else next[field] = value;
        return next;
      });
      return;
    }
    const saved = await track(WRITE_OWN[field](store, id, value));
    if (!saved.ok) toast.failed(saved);
  }

  // design §4.2: a value is the character's, in every chat of it, or shared by every 캐릭터 없이 chat. The next
  // turn reads it from the store (runtime/turn scopeOf).
  function flip(key: string, value: string) {
    void track(setToggle(store, chat.character, key, value)).then((saved) => saved.ok || toast.failed(saved));
  }

  async function reset() {
    const count = toggles.changed;
    const saved = await track(resetToggles(store, chat.character));
    if (!saved.ok) return toast.failed(saved);
    toast.show(`토글 ${count}개를 처음 값으로 되돌렸어요`);
  }

  async function rename(name: string) {
    if (!id) return;
    const saved = await renameChat(store, id, name);
    if (!saved.ok) toast.failed(saved);
    else setDialog(null);
  }

  return {
    id,
    item,
    shelf,
    card,
    route,
    prompt,
    persona,
    note: chat.note,
    toggles,
    notUsed: card && describeUnused(unused(card)),
    messages,
    texts,
    opening,
    last,
    busy,
    streaming,
    problem,
    editing,
    pinned,
    branching,
    panel,
    dialog,
    modelMenu,
    promptMenu,
    personaMenu,
    draft,
    scroll,
    actions: {
      send,
      answer: () => ask({ kind: 'answer' }),
      stop: () => talk.stop(),
      regenerate: (message: Shown) => ask({ kind: 'regenerate', message: message.id }),
      retry: (message: Shown) => ask({ kind: 'retry', message: message.id, version: shown(message).id }),
      swipe,
      edit: (message: Shown, text: string | null) => setEditing(text === null ? null : { id: message.id, text }),
      saveEdit,
      remove,
      copy,
      branch,
      pin: (message: Shown) => setPinned(pinned === message.id ? null : message.id),
      follow,
      info: (reply: string | null) => setPanel({ kind: 'info', id: reply }),
      showToggles: () => setPanel({ kind: 'toggles' }),
      closePanel: () => setPanel(null),
      openDialog: (which: 'keys' | 'rename' | 'reading') => setDialog(which),
      closeDialog: () => setDialog(null),
      pickModel,
      setOwn,
      flip,
      resetToggles: reset,
      rename,
      drop,
    },
  };
}
