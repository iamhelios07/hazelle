import { useEffect, useRef, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import { resolveAssets } from '../../engine/assets';
import { unused } from '../../engine/pipeline';
import { shown, type Chat, type ChatItem, type TranslateSwitches } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import type { ApiFailure } from '../../runtime/api';
import { chatModel, setChatModel } from '../../runtime/assignment';
import { resetToggles, setKeepStatus, setStatusScript, setToggle, setTranslate, translateSwitches } from '../../runtime/characters';
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
import { translatorOf } from '../../runtime/translate';
import { blocked, displayChat, takeTurn, togglesOf, statusBoxes, translateLatest, translationInput, type Blocked, type Target, type TurnFailure } from '../../runtime/turn';
import { describeTurnFailure } from '../common/failure';
import { languageLabel } from '../common/languages';
import { describeUnused } from '../common/unused';
import { useAssetUrl, useSession, useTranslating, useTurn } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { useMenuHandle, useViewport } from '../ui';
import { useDraft } from './useDraft';
import { toggleRows } from './toggles';
import { useFollow } from './useFollow';
import { useSeen } from './useSeen';

type Own = 'prompt' | 'persona' | 'note';
const WRITE_OWN = { prompt: setChatPrompt, persona: setChatPersona, note: setChatNote };

// The failures a chip fixes, shown by the composer for as long as they hold rather than as a toast.
const BLOCKING = new Set<TurnFailure['kind']>(['no-model', 'model-gone', 'prompt-missing', 'persona-missing', 'profile-missing']);
const blocks = (failure: TurnFailure): failure is Blocked => BLOCKING.has(failure.kind);

export type OpenChat = ReturnType<typeof useChat>;

// A persona or prompt list beside the chat, or one of them open from it, or the chat's character in 캐릭터 편집.
export type Side = { kind: 'personas'; id: string | null } | { kind: 'prompts'; id: string | null; pane: 'toggles' | null } | { kind: 'character'; id: string };
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
  const unstarted: Shown | null =
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
  const messages: Shown[] = withTurn(item?.messages ?? (unstarted ? [unstarted] : []), turn, chatId);
  // withTurn copies every message, so the greeting is the copy the screen holds, or no press on it matches.
  const opening = unstarted && messages[0]!;
  const [width, height] = useViewport().split('x').map(Number);
  const view = displayChat(session, chatId, chat, messages, { width: width!, height: height! });
  const { texts, css } = view;
  // 봇 꾸밈, on unless the character turned it off; a chat without a character has nothing to turn off.
  const bot = shelf?.character.decor !== false;
  // 상태창 지정 (design §6.4): the status window's boxes, and each message's boxes, which its tools offer to make one.
  const statusScripts = bot ? (shelf?.character.statusScripts ?? []) : [];
  const scriptName = (script: number) => card?.regex[script]?.name.trim() || `표시 스크립트 ${script + 1}`;
  const status = statusBoxes(view, messages, statusScripts).map((box) => ({ ...box, name: scriptName(box.script) }));
  const offered = view.drawn.map((scripts) => (bot ? scripts.map((script) => ({ script, name: scriptName(script), marked: statusScripts.includes(script) })) : []));
  const url = useAssetUrl();
  const translate = translateSwitches(store, chat.character);
  const sendLanguage = languageLabel(translate.inputLanguage);
  const translation = translatorOf(store, chat);
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
  // Where the status window stands: in its latest message, or with 옆에 두기 in the story's margin, while each box
  // fits there (fitting, which the margin reports whether it is shown or not). The key hides it there for now.
  const [fitting, setFitting] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const fits = status.length > 0 && status.every(({ script, drawn }) => drawn === null || fitting.get(script) === true);
  const beside = bot && shelf?.character.keepStatus === true && fits;
  const [hidden, setHidden] = useState(false);
  const hosted = messages.map((_, index) => (beside ? [] : status.flatMap(({ drawn }) => (drawn?.message === index ? [drawn] : []))));
  const { seen, watch } = useSeen();
  // 상태 shown over the story by its key or a tap, rather than by pointing at its tab. The tab is there while a box
  // is off screen, or never drawn in a message.
  const [peek, setPeek] = useState(false);
  const peeking = status.length > 0 && !(beside && !hidden) && (peek || status.some(({ script }) => !seen.has(script)));
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

  // 답장 번역 is shown awaited from the reply's first text; whether and when it starts is translateLatest's.
  const awaited = translate.replies && last?.live && texts.at(-1)!.trim() ? last.live : null;
  useEffect(() => {
    translateLatest(session, chatId, id === null ? { chat, messages: unstarted ? [unstarted] : [] } : undefined);
  }, [item, turn, translating, translate.replies, greeting]);

  // A reply starting here while 정보 is open shows its own information.
  const replyTarget = streaming ? (turn.reply.message ?? turn.reply.id) : null;
  useEffect(() => {
    if (replyTarget) setPanel((current) => (current?.kind === 'info' ? { kind: 'info', id: replyTarget } : current));
  }, [replyTarget]);

  function report(failure: TurnFailure | null) {
    if (!failure) return;
    if (blocks(failure)) return setStopped(true);
    toast.error(describeTurnFailure(failure), failure.kind === 'unsaved' ? { action: { label: '다시 저장', onClick: () => void talk.saveAgain(failure.reply).then(report) } } : undefined);
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

  // A long chat is saved in several requests, so the copy takes a moment.
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

  // null: follow the default again. A new chat holds it until its first send. The caller reports a failure.
  async function setOwn(field: Own, value: string | null): Promise<{ ok: true } | ApiFailure> {
    if (!id) {
      setUnsaved((current) => {
        const next = { ...current };
        if (value === null) delete next[field];
        else next[field] = value;
        return next;
      });
      return { ok: true };
    }
    return track(WRITE_OWN[field](store, id, value));
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

  async function markStatus(script: number, on: boolean) {
    const character = chat.character;
    if (!character) return;
    const saved = await track(setStatusScript(store, character, script, on));
    if (!saved.ok) return toast.failed(saved);
    if (!on && statusScripts.length === 1) setPeek(false);
    toast.undoable(on ? '상태창으로 지정했어요' : '상태창 지정을 풀었어요', () => void setStatusScript(store, character, script, !on));
  }

  // 옆에 두기, or on false 탭으로 접기, for every chat of the character.
  function keepStatus(keep: boolean) {
    if (!chat.character) return;
    setPeek(false);
    setHidden(false);
    void track(setKeepStatus(store, chat.character, keep)).then((saved) => saved.ok || toast.failed(saved));
  }

  // The key shows or hides 상태 for now, storing nothing: in the margin while it stands there, or else the drawer
  // over the story.
  function toggleStatus() {
    setPeek(beside ? false : !peek);
    if (beside) setHidden(!hidden);
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
    decor: { bot, css: bot ? resolveAssets(css, url) : '', url },
    status,
    hosted,
    offered,
    peek,
    peeking,
    aside: beside && !hidden,
    canKeep: fits,
    translate,
    sendLanguage,
    translation,
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
      inert: () => toast.show('봇의 버튼은 아직 동작하지 않아요.'),
      branch,
      pin: (message: Shown) => setPinned(pinned === message.id ? null : message.id),
      follow,
      info: (reply: string | null) => setPanel({ kind: 'info', id: reply }),
      showToggles: () => setPanel({ kind: 'toggles' }),
      side: (open: Side) => setPanel(open),
      // The keys open the list, and close it again while that list or one of its items is open.
      toggleSide: (kind: 'personas' | 'prompts') => setPanel((current) => (current?.kind === kind ? null : kind === 'personas' ? { kind, id: null } : { kind, id: null, pane: null })),
      closePanel: () => setPanel(null),
      setPeek,
      keepStatus: () => keepStatus(true),
      foldStatus: () => keepStatus(false),
      toggleStatus,
      fitStatus: (script: number, fits: boolean) => setFitting((current) => (current.get(script) === fits ? current : new Map(current).set(script, fits))),
      markStatus: (script: number, on: boolean) => void markStatus(script, on),
      watch,
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
