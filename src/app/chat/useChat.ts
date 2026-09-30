import { useEffect, useRef, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import { unused } from '../../engine/pipeline';
import { shown, type Chat, type ChatItem, type TranslateSwitches } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { chatModel, setChatModel } from '../../runtime/assignment';
import { resetToggles, setToggle, setTranslate, translateSwitches } from '../../runtime/characters';
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
} from '../../runtime/chat-log';
import { chatPersona } from '../../runtime/personas';
import { chatPrompt } from '../../runtime/prompts';
import { withTurn, type Shown } from '../../runtime/talk';
import { preloadTokenizer } from '../../runtime/tokenizer';
import { blocked, displayChat, takeTurn, togglesOf, translationInput, type Blocked, type Target, type TurnFailure } from '../../runtime/turn';
import { describeTurnFailure } from '../common/failure';
import { languageLabel } from '../common/languages';
import { describeUnused } from '../common/unused';
import { useSession, useTranslating, useTurn } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { useMenuHandle } from '../ui';
import { useDraft } from './useDraft';
import { toggleRows } from './toggles';
import { useFollow } from './useFollow';

type Own = 'prompt' | 'persona' | 'note';
const WRITE_OWN = { prompt: setChatPrompt, persona: setChatPersona, note: setChatNote };

// The failures a chip fixes, shown by the composer for as long as they hold rather than as a toast.
const BLOCKING = new Set<TurnFailure['kind']>(['no-model', 'model-gone', 'prompt-missing', 'persona-missing', 'profile-missing']);
const blocks = (failure: TurnFailure): failure is Blocked => BLOCKING.has(failure.kind);

export type OpenChat = ReturnType<typeof useChat>;

// A persona or prompt list beside the chat, or one of them open from it.
export type Side = { kind: 'personas'; id: string | null } | { kind: 'prompts'; id: string | null; pane: 'toggles' | null };
// Every part of the chat screen acts through this one object, so a new action is an entry here, not a prop per part.
export type ChatActions = OpenChat['actions'];

// item null is a new chat, saved with its first message; shelf null is 캐릭터 없이.
export function useChat(item: ChatItem | null, shelf: CharacterShelf<ChatItem> | null) {
  const session = useSession();
  const { store, talk, translator } = session;
  const turn = useTurn();
  const translating = useTranslating();
  const toast = useToast();
  const id = item?.id ?? null;
  // The id a new chat is shown under and then saved under, so its greeting's pick and rollp tags keep their rolls.
  const [newId] = useState(() => crypto.randomUUID());
  const chatId = id ?? newId;
  // A new chat's own model, prompt, persona and note, saved with it on the first send.
  const [unsaved, setUnsaved] = useState<Omit<Chat, 'title' | 'character'>>({ models: {} });
  const chat: Chat = item?.chat ?? { title: null, character: shelf?.id ?? null, ...unsaved };
  const route = chatModel(store, chat, 'main');
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
          versions: greetings.map((text, index) => ({ id: openingIds[index]!, seed: openingIds[index]!, text, receipt: null, edited: false, at: openedAt })),
          selected: greeting,
          live: null,
        }
      : null;
  // A new chat shows its turn while it is saved, under the id it is saved as.
  const messages: Shown[] = withTurn(item?.messages ?? (opening ? [opening] : []), turn, chatId);
  const texts = displayChat(session, chatId, chat, messages);
  const translate = translateSwitches(store, chat.character);
  const sendLanguage = languageLabel(translate.send);
  const translateModel = chatModel(store, chat, 'translate');
  const busy = turn !== null;
  const streaming = busy && turn.chat === chatId;
  const last = messages.at(-1);

  const draft = useDraft(id, chat.character);
  const { follow: toBottom, ...scroll } = useFollow(messages.length, streaming);
  const [dialog, setDialog] = useState<'rename' | 'reading' | null>(null);
  const modelMenu = useMenuHandle();
  const promptMenu = useMenuHandle();
  const personaMenu = useMenuHandle();
  // 정보, 토글 and the persona and prompt lists take the same place beside the story, so one closes another.
  const [panel, setPanel] = useState<{ kind: 'info'; id: string | null } | { kind: 'toggles' } | Side | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string; translation: string | null } | null>(null);
  // The versions shown the other way round from their default, the original in place of the translation.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [pinned, setPinned] = useState<string | null>(null);
  const [branching, setBranching] = useState(false);
  // Set when a send or a reply was stopped before the network; the composer then shows what stops the chat now,
  // so a fix made anywhere clears it.
  const [stopped, setStopped] = useState(false);
  const problem = stopped ? blocked(session, chat) : null;

  useEffect(preloadTokenizer, []);

  // 답장 번역: the latest reply awaits its translation from its first text, and is translated once it is whole,
  // whichever way it came, and when the switch goes on. One that failed is left for 다시 번역.
  const latest = last?.role === 'assistant' ? shown(last) : null;
  const awaited =
    translate.replies && latest && latest.receipt?.state !== 'failed' && !latest.translation && !translating.held.has(latest.id) && !translating.failed.has(latest.id) && texts.at(-1)!.trim()
      ? latest.id
      : null;
  const waiting = awaited && last!.live === null && !translating.live.has(awaited) ? awaited : null;
  useEffect(() => {
    if (waiting) translateMessage(last!);
  }, [waiting]);

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
    const start =
      id === null
        ? {
            chat,
            greetings: opening && {
              ids: opening.versions.map((version) => version.id),
              texts: opening.versions.map((version) => version.text),
              selected: opening.selected,
              translations: translating.held,
            },
            started: () => navigate({ kind: 'chat', id: chatId }, { replace: true }),
          }
        : null;
    const failure = await takeTurn(session, chatId, { kind: 'send', text }, start);
    // Only an unsaved reply means the user's message was saved. A new chat that was not saved stays on this screen.
    if (failure?.kind === 'unstarted') draft.set(text);
    else if (failure && failure.kind !== 'unsaved') draft.putBack(chatId, text);
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
    const exists = next >= 0 && next < message.versions.length;
    if (message === opening) {
      if (exists) setGreeting(next);
      return;
    }
    if (exists) select(message, next);
    else if (step === 1 && message === last) ask({ kind: 'regenerate', message: message.id });
  }

  function translateMessage(message: Shown) {
    translator.translate(chatId, shown(message).id, translationInput(session, chatId, chat, messages, { kind: 'message', index: messages.indexOf(message) }));
  }

  function flipTranslation(message: Shown) {
    const version = shown(message).id;
    const next = new Set(flipped);
    if (!next.delete(version)) next.add(version);
    setFlipped(next);
  }

  function setSwitches(change: Partial<TranslateSwitches>) {
    void track(setTranslate(store, chat.character, change)).then((saved) => saved.ok || toast.failed(saved));
  }

  async function saveEdit(message: Shown, andReply: boolean) {
    if (!id || !editing) return;
    const saved = await editMessage(store, id, message, editing.text, editing.translation);
    if (!saved.ok) return toast.failed(saved);
    setEditing(null);
    if (andReply && last && last.role === 'assistant') ask({ kind: 'regenerate', message: last.id });
  }

  async function remove(message: Shown) {
    if (!id) return;
    const saved = await removeMessage(store, id, message.id);
    if (!saved.ok) return toast.failed(saved);
    toast.undoable('메시지를 지웠어요', () => void restoreMessage(store, id, message.id));
  }

  // The copy is saved one entry after another, so a long chat takes a while.
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

  // null: follow the default again. A new chat holds it until its first send.
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

  // A value is the character's, in every chat of it, or shared by every 캐릭터 없이 chat.
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
    translate,
    sendLanguage,
    translateModel,
    translating,
    awaited,
    flipped,
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
      continue: (message: Shown) => ask({ kind: 'continue', message: message.id, version: shown(message).id }),
      swipe,
      edit: (message: Shown) => {
        const version = shown(message);
        setEditing({ id: message.id, text: version.text, translation: version.translation?.text ?? null });
      },
      changeEdit: (change: { text: string } | { translation: string }) => setEditing((current) => current && { ...current, ...change }),
      cancelEdit: () => setEditing(null),
      saveEdit,
      translate: translateMessage,
      flipTranslation,
      setTranslate: setSwitches,
      remove,
      copy,
      branch,
      pin: (message: Shown) => setPinned(pinned === message.id ? null : message.id),
      follow,
      info: (reply: string | null) => setPanel({ kind: 'info', id: reply }),
      showToggles: () => setPanel({ kind: 'toggles' }),
      side: (open: Side) => setPanel(open),
      // The keys open the list, and close it again while that list or one of its items is open.
      toggleSide: (kind: Side['kind']) => setPanel((current) => (current?.kind === kind ? null : kind === 'personas' ? { kind, id: null } : { kind, id: null, pane: null })),
      closePanel: () => setPanel(null),
      openDialog: (which: 'rename' | 'reading') => setDialog(which),
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
