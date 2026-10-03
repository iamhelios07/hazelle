import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import { resolveAssets } from '../../engine/assets';
import { unused } from '../../engine/pipeline';
import { shown, type Chat, type ChatItem, type ChatSummary, type TranslateSwitches } from '../../model/chat';
import { greetingTranslation, type CharacterShelf } from '../../model/library';
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
  startChat,
} from '../../runtime/chat-log';
import { greetingPreview, projectGreetings, startingGreetings } from '../../runtime/greetings';
import { chatPersona } from '../../runtime/personas';
import { chatPrompt } from '../../runtime/prompts';
import { triggersOf } from '../../runtime/scripts';
import type { Shown } from '../../runtime/talk';
import { translatorOf } from '../../runtime/translate';
import { blocked, packsOf, takeTurn, togglesOf, statusBoxes, translationInput, type Blocked, type Target, type TurnFailure } from '../../runtime/turn';
import { describeTurnFailure } from '../common/failure';
import { languageLabel } from '../common/languages';
import { describeUnused } from '../common/unused';
import { BIN_KEEPS } from '../common/words';
import { useAssetUrl, useChatDisplay, useChatMemory, useSession, useTranslating, useTurn } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { useMenuHandle, useViewport, type BotButton, type Reading } from '../ui';
import { useSendNotes } from './useSendNotes';
import { useDraft } from './useDraft';
import { pickStarted } from './infoReply';
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

// item null is a new chat, saved under chatId with its first message; shelf null is 캐릭터 없이.
export function useChat(chatId: string, item: ChatItem | null, shelf: CharacterShelf<ChatSummary> | null, reply: Reading['reply']) {
  const session = useSession();
  const { store, talk, translator, drafts } = session;
  const turn = useTurn();
  const translating = useTranslating();
  const toast = useToast();
  const id = item ? chatId : null;
  // A new chat's own model, prompt, persona and note, saved with it on the first send.
  const [unsaved, setUnsaved] = useState<Omit<Chat, 'title' | 'character'>>({ models: {} });
  const chat: Chat = useMemo(() => item ? item.chat : { title: null, character: shelf?.id ?? null, ...unsaved }, [item?.chat, shelf?.id, unsaved]);
  const route = chatModel(store, chat, 'main');
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const toggles = toggleRows(togglesOf(store, chat, prompt), prompt.kind === 'prompt' ? prompt.prompt.value.toggles.length : 0);
  const card = shelf?.character.card ?? null;
  // Any trigger may answer a press: a Lua one by a function of the button's name, a block one by its own name.
  const scripted = triggersOf(packsOf(store, chat).map(({ pack }) => pack)).length > 0;
  const [openedAt] = useState(() => Date.now());
  const greetings = card?.greetings ?? [];
  const [picked, setGreeting] = useState<number | null>(null);
  // The ids the greetings are saved under, so their random tags roll the same before and after the first send, and the
  // greeting keeps its place in the story rather than being drawn again. A greeting added since gets its own.
  const [madeIds, setOpeningIds] = useState(() => greetings.map(() => crypto.randomUUID()));
  const openingIds = madeIds.length < greetings.length ? [...madeIds, ...greetings.slice(madeIds.length).map(() => crypto.randomUUID())] : madeIds;
  if (openingIds !== madeIds) setOpeningIds(openingIds);
  const translate = translateSwitches(store, chat.character);
  const choices = useMemo(() => item === null && card
    ? projectGreetings(greetings, openingIds, picked, (text) => greetingTranslation(shelf!.character, text, translate.replyLanguage))
    : null, [item === null, card, shelf?.character.greetingTranslations, translate.replyLanguage, openingIds, picked]);
  const unstarted: Shown | null = useMemo(() => {
    const preview = greetingPreview(choices, openedAt);
    return preview && { ...preview, live: null };
  }, [choices, openedAt]);
  // A new chat shows its turn while it is saved, under the id it is saved as.
  const openingMessages = useMemo(() => unstarted ? [unstarted] : [], [unstarted]);
  const [width, height] = useViewport().split('x').map(Number);
  const { messages, display: view, pending: displayPending, error: displayError, retry: retryDisplay } = useChatDisplay(chatId, { chat, messages: openingMessages }, { width: width!, height: height! });
  const opening = unstarted && messages[0]!;
  // A display that fails after one was shown leaves that one up; one that never showed says so in the log (ChatLog).
  useEffect(() => {
    if (displayError === undefined || displayPending) return;
    toast.error('채팅 표시를 계산하지 못했어요.', { detail: displayError instanceof Error ? displayError.message : undefined, action: { label: '다시 시도', onClick: retryDisplay } });
  }, [displayError]);
  const { texts, css } = view;
  // 봇 꾸밈, on unless the character turned it off; a chat without a character has nothing to turn off.
  const bot = shelf?.character.decor !== false;
  // 상태창 지정 (design §6.4): the status window's boxes, and each message's boxes, which its tools offer to make one.
  const statusScripts = bot ? (shelf?.character.statusScripts ?? []) : [];
  const scriptName = (script: number) => card?.regex[script]?.name.trim() || `표시 스크립트 ${script + 1}`;
  const status = statusBoxes(view, messages, statusScripts).map((box) => ({ ...box, name: scriptName(box.script) }));
  // Only the card's own scripts, which come first among the packs': a module's place moves as modules go on and off.
  const own = card?.regex.length ?? 0;
  const offered = (index: number) => bot ? view.drawn[index]!.filter((script) => script < own).map((script) => ({ script, name: scriptName(script), marked: statusScripts.includes(script) })) : [];
  const url = useAssetUrl();
  const sendLanguage = languageLabel(translate.inputLanguage);
  const translation = translatorOf(store, chat);
  const busy = turn !== null;
  const streaming = busy && turn.chat === chatId;
  const last = messages.at(-1);

  // A reply starting here while 정보 is held shows its own information.
  const replyTarget = streaming ? (turn.reply.message ?? turn.reply.id) : null;
  // The message a reply answers, the one before it; 이어 쓰기 answers none, since it goes on under text already read.
  const replyAt = messages.findIndex((message) => message.id === replyTarget);
  const answered = streaming && replyAt > 0 && !turn.reply.continues ? messages[replyAt - 1]!.id : null;

  const draft = useDraft(id, chat.character);
  const { follow: toBottom, beforeTurn, seekTo, ...scroll } = useFollow(messages.length, streaming, answered, reply === 'stay');
  const memory = useChatMemory(id);
  const { cache, leaving } = useSendNotes(id, chat, messages, memory, draft.text, busy);
  const [dialog, setDialog] = useState<'rename' | 'reading' | null>(null);
  const modelMenu = useMenuHandle();
  const promptMenu = useMenuHandle();
  const personaMenu = useMenuHandle();
  // 토글, 장기 기억 and the persona and prompt lists take the same place beside the story, so one closes another.
  // record: the memory record open in the panel, in place of the whole memory.
  const [panel, setPanel] = useState<{ kind: 'toggles' } | { kind: 'memory'; record: string | null } | Side | null>(null);
  // The messages a memory record was made from, marked in the story: at changes with each look, so the same ones are
  // marked again.
  const [found, setFound] = useState<{ ids: ReadonlySet<string>; at: number } | null>(null);
  // Where the status window stands: in its latest message, or with 옆에 두기 in the story's margin, while each box
  // fits there (fitting, which the margin reports whether it is shown or not). The key hides it there for now.
  const [fitting, setFitting] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const fits = status.length > 0 && status.every(({ script, drawn }) => drawn === null || fitting.get(script) === true);
  const beside = bot && shelf?.character.keepStatus === true && fits;
  const [hidden, setHidden] = useState(false);
  const hosted = (index: number) => beside ? [] : status.flatMap(({ drawn }) => (drawn?.message === index ? [drawn] : []));
  const { seen, watch } = useSeen();
  // 상태 or 답장 정보 shown over the story by a key or a tap, rather than by pointing at its tab. Their drawers slide
  // over the same place, so holding one lets go of the other.
  const [held, setHeld] = useState<'status' | 'info' | null>(null);
  const hold = (which: 'status' | 'info', open: boolean) => setHeld((current) => (open ? which : current === which ? null : current));
  // 상태's tab is there while a box is off screen, or never drawn in a message.
  const peeking = status.length > 0 && !(beside && !hidden) && (held === 'status' || status.some(({ script }) => !seen.has(script)));
  // The reply a message's ⓘ or 정보's stepper picked, kept while the chat is open; null follows the latest.
  const [infoPick, setInfoPick] = useState<string | null>(null);
  const infoDrawer = useId();
  const [editing, setEditing] = useState<{ id: string; text: string; translation: string | null } | null>(null);
  // The versions shown the other way round from their default, the original in place of the translation.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [pinned, setPinned] = useState<string | null>(null);
  const [branching, setBranching] = useState(false);
  // Set when a send or a reply was stopped before the network; the composer then shows what stops the chat now,
  // so a fix made anywhere clears it.
  const [stopped, setStopped] = useState(false);
  const problem = stopped ? blocked(session, chat) : null;

  useEffect(() => {
    if (id) session.memory.check(id);
  }, [id]);

  // 답장 번역 is shown awaited from the reply's first text; whether and when it starts is translateReceived's.
  const awaited = translate.replies && last?.live && texts.at(-1)!.trim() ? last.live : null;

  useEffect(() => {
    if (replyTarget && held === 'info') setInfoPick(pickStarted(messages, replyTarget));
  }, [replyTarget]);

  function report(failure: TurnFailure | null) {
    if (!failure) return;
    if (blocks(failure)) return setStopped(true);
    const kept = failure.kind === 'unsaved' ? failure.reply : null;
    toast.error(describeTurnFailure(failure), kept === null ? undefined : { action: { label: '다시 저장', onClick: () => void talk.saveAgain(kept).then(report) } });
  }

  // Back to the foot of the story, which also puts away tools a tap pinned open.
  function follow() {
    toBottom();
    setPinned(null);
  }

  function asking() {
    beforeTurn();
    setPinned(null);
  }

  // The new chat as it is saved: by its first send, or by a press on a button of its greeting.
  function starting() {
    return {
      chat,
      greetings: startingGreetings(choices),
      started: () => {
        drafts.move(draft.key, chatId);
        navigate({ kind: 'chat', id: chatId }, { replace: true });
      },
    };
  }

  async function send() {
    if (!draft.text.trim() || busy) return;
    await Promise.all(writes.current);
    // A saved chat is asked of the store, as the turn reads it: this render's copy was made before the wait.
    const now = id === null ? chat : store.get('chat', id)?.value;
    if (now && blocked(session, now)) return setStopped(true);
    // Taken only now: the composer stayed open through the wait, so what was typed in it goes with the message, and a
    // turn that began meanwhile leaves the text where it is.
    const text = drafts.text(draft.key).trim();
    if (!text || talk.snapshot()) return;
    setStopped(false);
    drafts.set(draft.key, '');
    asking();
    const failure = await takeTurn(session, chatId, { kind: 'send', text }, id === null ? starting() : null);
    // An unsaved reply or a kept failure means the user's message was saved. Any other failure's text goes back to the
    // chat's draft, wherever that is by now: a new chat may have been saved before the failure, or not at all.
    if (failure && failure.kind !== 'unsaved' && !failure.kept) drafts.putBack(store.get('chat', chatId) ? chatId : draft.key, text);
    report(failure);
  }

  // The save a press started for a new chat, which every press made before the chat is here waits for: a second
  // save would be refused.
  const saving = useRef<Promise<ApiFailure | null> | null>(null);
  async function press(button: BotButton | null) {
    const unanswered = () => toast.show('이 버튼에는 이어진 동작이 없어요.');
    if (!scripted) return unanswered();
    if (button === null) return;
    // A script runs over a saved chat only, so a press on a new chat's greeting saves it first.
    if (id === null) {
      const start = starting();
      saving.current ??= startChat(store, chatId, start.chat, start.greetings).then((unstarted) => {
        if (unstarted) saving.current = null;
        else start.started();
        return unstarted;
      });
      const unstarted = await saving.current;
      if (unstarted) return toast.failed(unstarted);
    }
    if (!(await session.scripts.press(chatId, button))) unanswered();
  }

  function ask(target: Target) {
    if (!id || busy) return;
    asking();
    void Promise.all(writes.current).then(() => takeTurn(session, id, target)).then(report);
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

  function pick(message: Shown, index: number) {
    if (busy) return;
    if (message === opening) setGreeting(index);
    else select(message, index);
  }

  function translateMessage(message: Shown) {
    translator.translate(chatId, shown(message), translationInput(session, chatId, chat, messages, { kind: 'message', index: messages.indexOf(message) }));
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
    const taken = editing;
    const saved = await editMessage(store, id, message, taken.text, taken.translation);
    if (!saved.ok) return toast.failed(saved);
    // Only the edit that was saved closes: one changed since, or another message's opened meanwhile, stays open.
    setEditing((current) => (current === taken ? null : current));
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
    toast.undoable(`‘${item.title}’ 채팅을 지웠어요.`, () => void restoreChat(store, stored.id).then((saved) => saved.ok && navigate({ kind: 'chat', id: stored.id })), BIN_KEEPS);
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.show('복사했어요'),
      () => toast.error('복사하지 못했어요.', { detail: '브라우저가 클립보드를 막았어요.' }),
    );
  }

  // Every turn waits for these, so a model, note or toggle changed just before it reaches that turn: the turn reads the
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
    if (!on && statusScripts.length === 1) hold('status', false);
    toast.undoable(on ? '상태창으로 지정했어요' : '상태창 지정을 풀었어요', () => void setStatusScript(store, character, script, !on), [scriptName(script), card?.name].filter(Boolean).join(' · '));
  }

  // 옆에 두기, or on false 탭으로 접기, for every chat of the character.
  function keepStatus(keep: boolean) {
    if (!chat.character) return;
    hold('status', false);
    setHidden(false);
    void track(setKeepStatus(store, chat.character, keep)).then((saved) => saved.ok || toast.failed(saved));
  }

  // The key shows or hides 상태 for now, storing nothing: in the margin while it stands there, or else the drawer
  // over the story.
  function toggleStatus() {
    hold('status', !beside && held !== 'status');
    if (beside) setHidden(!hidden);
  }

  async function rename(name: string) {
    if (!id) return;
    const saved = await renameChat(store, id, name);
    if (!saved.ok) toast.failed(saved);
    else setDialog(null);
  }

  return {
    displayPending, displayError, retryDisplay,
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
    decor: { bot, css: bot ? resolveAssets(css, url) : '', url, buttons: scripted ? ('live' as const) : ('inert' as const) },
    status,
    hosted,
    offered,
    held,
    peeking,
    infoPick,
    infoDrawer,
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
    cache,
    leaving,
    found,
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
      pick,
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
      press: (button: BotButton | null) => void press(button),
      branch,
      pin: (message: Shown) => setPinned(pinned === message.id ? null : message.id),
      follow,
      info: (reply: string) => {
        setInfoPick(reply);
        setHeld('info');
      },
      pickInfo: setInfoPick,
      toggleInfo: () => hold('info', held !== 'info'),
      showToggles: () => setPanel({ kind: 'toggles' }),
      memory: (record: string | null) => setPanel({ kind: 'memory', record }),
      // ids in chat order; the view goes to the first.
      find: (ids: string[]) => {
        if (!ids.length) return;
        seekTo(ids[0]!, 'center');
        setFound({ ids: new Set(ids), at: Date.now() });
      },
      side: (open: Side) => setPanel(open),
      // The keys open the list, and close it again while that list or one of its items is open.
      toggleSide: (kind: 'personas' | 'prompts') => setPanel((current) => (current?.kind === kind ? null : kind === 'personas' ? { kind, id: null } : { kind, id: null, pane: null })),
      closePanel: () => setPanel(null),
      hold,
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
