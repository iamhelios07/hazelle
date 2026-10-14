import { useEffect, useMemo, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import { resolveAssets } from '../../engine/assets';
import { unused } from '../../engine/pipeline';
import { shown, type Chat, type ChatItem, type ChatSummary, type TranslateSwitches } from '../../model/chat';
import type { IllustrateSwitches, Scene } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import type { CharacterShelf } from '../../model/library';
import type { ApiFailure } from '../../runtime/api';
import { chatModel, setChatModel, withMainModel } from '../../runtime/assignment';
import { illustrateSwitches, resetToggles, setIllustrate, setOwnIllustrate, setOwnTranslate, setToggle, setTranslate, translateSwitches } from '../../runtime/characters';
import { removeIllustration, restoreIllustration, type Drawing } from '../../runtime/illustrate';
import {
  nameBookmark,
  removeChat,
  renameChat,
  restoreChat,
  setBookmark,
  setCast,
  setChatNote,
  setChatPersona,
  setChatPrompt,
  withCast,
  withOwn,
  type Own,
} from '../../runtime/chat-log';
import { branchFrom, pickVersion } from '../../runtime/message-acts';
import { badgesByVersion, toolActions, toolComposer } from './toolMenu';
import { chatPersona, pinPersona, setCurrentPersona } from '../../runtime/personas';
import { chatPrompt } from '../../runtime/prompts';
import { triggersOf } from '../../runtime/scripts';
import type { Shown } from '../../runtime/talk';
import { translatorOf } from '../../runtime/translate';
import { blocked, isBlocked, type Target } from '../../runtime/turn-context';
import { packsOf, togglesOf, translationInput } from '../../runtime/chat-context';
import { takeTurn, type TurnFailure } from '../../runtime/turn';
import { describeIllustrateFailure, describeTurnFailure } from '../common/failure';
import { languageLabel } from '../common/languages';
import { describeUnused } from '../common/unused';
import { useCopy } from '../common/useCopy';
import { BIN_KEEPS, BOOKMARK, LORE_BUDGET_LABEL, PAGES } from '../common/words';
import { useAssetUrl, useChatDisplay, useChatMemory, useChatTools, useChildren, useIllustrating, useSaves, useSession, useTranslating, useTurn } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { useMenuHandle, usePanelsBeside, useViewport, type BotButton, type Reading } from '../ui';
import { flippedCache, cacheShown, NO_PANELS, opened, type Panel, type Panels, type Side } from './panels';
import { useSendNotes } from './useSendNotes';
import type { BookmarkRow } from './bookmarks';
import { useDraft } from './useDraft';
import { pickStarted } from './infoReply';
import { toggleRows, toggleSaveKey } from './toggles';
import { useFollow } from './useFollow';
import { useChatSearch } from './useChatSearch';
import { useChatStatus } from './useChatStatus';
import { useMessageEdit } from './useMessageEdit';
import { useNewChat } from './useNewChat';

const WRITE_OWN = { prompt: setChatPrompt, persona: setChatPersona, note: setChatNote };

// The failures a toast already said, by run: each is said once, though the chat is left and opened again.
const told = new WeakSet<Drawing>();
// The chats told this session that a reply's lorebook entries went past the 로어북 최대 분량: each is told once.
const cutTold = new Set<string>();

// A version's pictures, oldest first.
function picturesByVersion(illustrations: Stored<'illustration'>[]): ReadonlyMap<string, Stored<'illustration'>[]> {
  const versions = new Map<string, Stored<'illustration'>[]>();
  for (const picture of [...illustrations].sort((a, b) => a.value.at - b.value.at)) {
    const pictures = versions.get(picture.value.version);
    if (pictures) pictures.push(picture);
    else versions.set(picture.value.version, [picture]);
  }
  return versions;
}

// 어떻게 바꿀까요?: the scene a picture or a failed run had, drawn again once changed. paragraphs: how many its version holds.
export type Reshaping = { message: string; version: string; scene: Scene; paragraphs: number };

export type OpenChat = ReturnType<typeof useChat>;

// Every part of the chat screen acts through this one object, so a new action is an entry here, not a prop per part.
export type ChatActions = OpenChat['actions'];

// item null is a new chat, saved under chatId with its first message; shelf null is 캐릭터 없이.
export function useChat(chatId: string, item: ChatItem | null, shelf: CharacterShelf<ChatSummary> | null, reply: Reading['reply']) {
  const session = useSession();
  const { store, talk, translator, illustrator, drafts } = session;
  const saves = useSaves();
  const turn = useTurn(chatId);
  const translating = useTranslating();
  const toast = useToast();
  const copy = useCopy();
  const id = item ? chatId : null;
  const tools = useChatTools(id);
  useEffect(() => {
    if (!id) return;
    void session.tools.warm(id);
    session.scripts.claims(id);
  }, [id, tools]);
  const [unsaved, setUnsaved] = useState<Omit<Chat, 'title' | 'character'>>({ models: {} });
  const chat: Chat = useMemo(() => item ? item.chat : { title: null, character: shelf?.id ?? null, ...unsaved }, [item?.chat, shelf?.id, unsaved]);
  const route = chatModel(store, chat, 'main');
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const toggles = toggleRows(togglesOf(store, chat, prompt));
  const card = shelf?.character.card ?? null;
  // Any trigger may answer a press: a Lua one by a function of the button's name, a block one by its own name.
  const scripted = triggersOf(packsOf(store, chat)).length > 0;
  const translate = translateSwitches(store, chat.character);
  const { unstarted, pickGreeting, starting } = useNewChat(chatId, item === null, chat, shelf, translate.replyLanguage);
  const openingMessages = useMemo(() => unstarted ? [unstarted] : [], [unstarted]);
  const [width, height] = useViewport().split('x').map(Number);
  const { messages, display: view, placed, pending: displayPending, error: displayError, retry: retryDisplay, retryRegex, stuck } = useChatDisplay(chatId, { chat, messages: openingMessages }, { width: width!, height: height! });
  const opening = unstarted && messages[0]!;
  // A display that fails after one was shown leaves that one up; one that never showed says so in the log (ChatLog).
  useEffect(() => {
    if (displayError === undefined || displayPending) return;
    toast.error('채팅을 표시하지 못했어요.', { detail: displayError instanceof Error ? displayError.message : undefined, action: { label: '다시 시도', onClick: retryDisplay } });
  }, [displayError]);
  const { texts, css } = view;
  const bot = shelf?.character.decor !== false;
  const url = useAssetUrl();
  const sendLanguage = languageLabel(translate.inputLanguage);
  const translation = translatorOf(store, chat);
  const illustrate = illustrateSwitches(store, chat.character);
  const illustrations = useChildren('illustration', id);
  const pictures = useMemo(() => picturesByVersion(illustrations), [illustrations]);
  const toolData = useChildren('toolchat', id);
  const badges = useMemo(() => badgesByVersion(toolData, tools), [toolData, tools]);
  const messageTools = useMemo(() => toolActions(tools), [tools]);
  const composerTools = useMemo(() => toolComposer(tools), [tools]);
  const illustrating = useIllustrating();
  // Settled by the switch and the pictures, not by a picture landing, so the story moves aside before one does.
  const stage = illustrate.auto || illustrations.length > 0 || [...illustrating.values()].some((drawing) => drawing.chat === chatId);
  const [reshaping, setReshaping] = useState<Reshaping | null>(null);
  const busy = turn !== null;
  const last = messages.at(-1);

  const replyTarget = busy ? (turn.reply.message ?? turn.reply.id) : null;
  // 이어 쓰기 answers none, since it goes on under text already read.
  const replyAt = messages.findIndex((message) => message.id === replyTarget);
  const answered = busy && replyAt > 0 && !turn.reply.continues ? messages[replyAt - 1]!.id : null;

  const draft = useDraft(id, chat.character);
  const { follow: toBottom, beforeTurn, seekTo, ...scroll } = useFollow(messages.length, busy, answered, reply === 'stay');
  const memory = useChatMemory(id);
  const { cache, leaving } = useSendNotes(id, chat, messages, memory, draft.text, busy || displayPending === true);
  const [dialog, setDialog] = useState<'rename' | 'reading' | 'persona' | 'prompt' | 'export' | null>(null);
  const modelMenu = useMenuHandle();
  const castMenu = useMenuHandle();
  const pairs = usePanelsBeside();
  const [panels, setPanels] = useState<Panels>(NO_PANELS);
  const { panel } = panels;
  const open = (next: Panel) => setPanels((current) => opened(current, next, pairs));
  const flipPanel = (next: Panel, same: (current: Panel) => boolean) => setPanels((current) => (current.panel && same(current.panel) ? { ...current, panel: null } : opened(current, next, pairs)));
  // null follows the latest.
  const [infoPick, setInfoPick] = useState<string | null>(null);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const [pinned, setPinned] = useState<string | null>(null);
  const [branching, setBranching] = useState(false);
  const { found, search, actions: searchActions } = useChatSearch(messages, texts, translating, flipped, seekTo);
  const bookmarked = useMemo(() => new Set(chat.bookmarks?.map(({ message }) => message)), [chat.bookmarks]);
  // A bookmark after another version, seeked once the switch to it puts it in the story: a seek to a row not there yet
  // is lost.
  const [seeking, setSeeking] = useState<string | null>(null);
  const { actions: statusActions, ...status } = useChatStatus(chat, shelf?.character ?? null, view, messages);
  const { editing, actions: editActions } = useMessageEdit(id, messages, (message) => ask({ kind: 'regenerate', message: message.id }));
  // Set when a send or a reply was stopped before the network; the composer then shows what stops the chat now,
  // so a fix made anywhere clears it.
  const [stopped, setStopped] = useState(false);
  const problem = stopped ? blocked(session, chat) : null;

  useEffect(() => {
    if (id) session.memory.check(id);
  }, [id]);

  useEffect(() => {
    if (seeking === null || !messages.some((message) => message.id === seeking)) return;
    searchActions.find([seeking]);
    setSeeking(null);
  }, [messages, seeking]);

  useEffect(() => {
    for (const drawing of illustrating.values()) {
      if (drawing.chat !== chatId || drawing.stage !== 'failed' || told.has(drawing)) continue;
      told.add(drawing);
      toast.error(describeIllustrateFailure(drawing.failure));
    }
  }, [illustrating]);

  // Only a reply this page asked for has what it sent (runtime/talk sent), so it is told the moment that reply lands.
  const lastReply = messages.findLast((message) => message.role === 'assistant');
  const lastCall = lastReply && shown(lastReply).receipt?.id;
  useEffect(() => {
    if (!lastReply || !lastCall || cutTold.has(chatId)) return;
    const cut = talk.sent(lastCall)?.prompt.lore?.filter(({ fate }) => fate.kind === 'dropped' && fate.cause === 'budget').length ?? 0;
    if (cut === 0) return;
    cutTold.add(chatId);
    toast.show(`로어북 항목 ${cut}개가 빠졌어요`, {
      detail: `${LORE_BUDGET_LABEL}을 넘었어요. 설정 › ${PAGES.chat}에서 늘릴 수 있어요.`,
      action: { label: '정보 보기', onClick: () => { setInfoPick(lastReply.id); open({ kind: 'info' }); } },
    });
  }, [lastCall]);

  // 응답 번역 is shown awaited from the reply's first text; whether and when it starts is translateReceived's.
  const awaited = translate.replies && last?.live && texts.at(-1)!.trim() ? last.live : null;

  useEffect(() => {
    if (replyTarget && panel?.kind === 'info') setInfoPick(pickStarted(messages, replyTarget));
  }, [replyTarget]);

  function report(failure: TurnFailure | null) {
    if (!failure) return;
    if (isBlocked(failure)) return setStopped(true);
    const kept = failure.kind === 'unsaved' ? failure.reply : null;
    toast.error(describeTurnFailure(failure), kept === null ? undefined : { action: { label: '다시 저장', onClick: () => void talk.saveAgain(kept).then(report) } });
  }

  function follow() {
    toBottom();
    setPinned(null);
  }

  function asking() {
    beforeTurn();
    setPinned(null);
  }

  async function send() {
    if (!draft.text.trim() || busy) return;
    if (blocked(session, chat)) return setStopped(true);
    const text = drafts.text(draft.key).trim();
    if (!text || talk.snapshot(chatId)) return;
    setStopped(false);
    drafts.set(draft.key, '');
    asking();
    const failure = await takeTurn(session, chatId, { kind: 'send', text }, id === null ? starting() : null);
    // An unsaved reply or a kept failure means the user's message was saved. Any other failure's text goes back to the
    // chat's draft, wherever that is by now: a new chat may have been saved before the failure, or not at all.
    if (failure && failure.kind !== 'unsaved' && !failure.kept) drafts.putBack(store.get('chat', chatId) ? chatId : draft.key, text);
    report(failure);
  }

  async function press(button: BotButton | null) {
    const unanswered = () => toast.show('동작이 연결되지 않은 버튼이에요.');
    if (!scripted) return unanswered();
    if (button === null) return;
    // A script runs over a saved chat only, so a press on a new chat's greeting saves it first.
    if (id === null) {
      const unstarted = await starting().saved;
      if (unstarted) return toast.failed(unstarted);
    }
    if (!(await session.scripts.press(chatId, button))) unanswered();
  }

  function ask(target: Target) {
    if (!id || busy) return;
    asking();
    void takeTurn(session, id, target).then(report);
  }

  function select(message: Shown, index: number) {
    if (!id) return;
    void pickVersion(session, id, message, index).then((saved) => saved.ok || toast.failed(saved));
  }

  // The versions go round: ← on the first lands on the last (user, 2026-10-04). → past a reply's last asks for a new one;
  // a greeting has none to ask for, so it goes round too.
  function swipe(message: Shown, step: -1 | 1) {
    if (busy) return;
    const count = message.versions.length;
    const next = message.selected + step;
    if (message === opening) pickGreeting((next + count) % count);
    else if (next >= count && shown(message).greeting === undefined) ask({ kind: 'regenerate', message: message.id });
    else select(message, (next + count) % count);
  }

  function pick(message: Shown, index: number) {
    if (busy) return;
    if (message === opening) pickGreeting(index);
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
    void setTranslate(store, chat.character, change).then((saved) => saved.ok || toast.failed(saved));
  }

  function setOwnSwitches(own: boolean) {
    void setOwnTranslate(store, chat.character!, own).then((saved) => saved.ok || toast.failed(saved));
  }

  function setIllustrateSwitches(change: Partial<IllustrateSwitches>) {
    void setIllustrate(store, chat.character, change).then((saved) => saved.ok || toast.failed(saved));
  }

  function setOwnIllustrateSwitches(own: boolean) {
    void setOwnIllustrate(store, chat.character!, own).then((saved) => saved.ok || toast.failed(saved));
  }

  // scene: one already written, drawn again with no scene call. spend: the user's 그래도 만들기 on a picture that may cost.
  function draw(message: string, version: string, scene: Scene | null = null, spend = false) {
    if (id) illustrator.draw(id, message, version, { scene, spend });
  }

  function dropPicture(picture: Stored<'illustration'>) {
    void removeIllustration(store, picture.id).then((removed) => removed.ok || toast.failed(removed));
    toast.undoable('삽화를 삭제했어요.', () => restoreIllustration(store, picture));
  }

  async function branch(message: Shown) {
    if (!item || branching) return;
    setBranching(true);
    toast.show('채팅 분기 중…');
    const made = await branchFrom(session, item, message.id);
    setBranching(false);
    if (!made.ok) return toast.failed(made, '채팅을 분기하지 못했어요.');
    navigate({ kind: 'chat', id: made.data });
    toast.show('새 채팅으로 분기했어요.');
  }

  function drop() {
    if (!item) return;
    const { id: dropped, title } = item;
    talk.stop(dropped);
    void removeChat(store, dropped).then((removed) => removed.ok || toast.failed(removed));
    navigate({ kind: 'shelf', character: chat.character });
    toast.undoable(`'${title}' 채팅을 삭제했어요.`, () => {
      const restored = restoreChat(store, dropped);
      navigate({ kind: 'chat', id: dropped });
      return restored;
    }, BIN_KEEPS);
  }

  function pickModel(ref: ModelRef) {
    if (!id) {
      setUnsaved((current) => withMainModel(current, ref));
      return;
    }
    void setChatModel(store, id, ref).then((saved) => saved.ok || toast.failed(saved));
  }

  // null: follow the default again. A new chat holds it until its first send. The caller reports a failure.
  async function setOwn(field: Own, value: string | null): Promise<{ ok: true } | ApiFailure> {
    if (!id) {
      setUnsaved((current) => withOwn(current, field, value));
      return { ok: true };
    }
    return WRITE_OWN[field](store, id, value);
  }

  // A pick is this chat's persona and the current one, which a chat not saved yet follows.
  async function choosePersona(persona: string): Promise<{ ok: true } | ApiFailure> {
    const own = await setOwn('persona', persona);
    return own.ok ? setCurrentPersona(store, persona) : own;
  }

  function changeCast(ids: string[]) {
    if (!id) {
      setUnsaved((current) => withCast(current, chat.character, ids));
      return;
    }
    void setCast(store, id, ids).then((saved) => saved.ok || toast.failed(saved));
  }

  // A value is the character's, in every chat of it, or shared by every 캐릭터 없이 chat.
  const writeToggle = (key: string, value: string) => setToggle(store, chat.character, key, value);

  function flip(key: string, value: string) {
    void writeToggle(key, value).then((saved) => saved.ok || toast.failed(saved));
  }

  async function reset() {
    // A typed value still waiting would land over the reset.
    await Promise.all(toggles.sections.flatMap(({ rows }) => rows.flatMap(({ toggle }) => (toggle.kind === 'text' ? [saves.flush(toggleSaveKey(chat.character, toggle.key))] : []))));
    void resetToggles(store, chat.character).then((saved) => saved.ok || toast.failed(saved));
    toast.show(`토글 ${toggles.changed}개를 기본값으로 되돌렸어요.`);
  }

  function runTool(module: string, run: (chat: string) => Promise<unknown>) {
    if (id) void run(id).catch((error: unknown) => session.scripts.report(id, error, { kind: 'module', id: module }));
  }

  function bookmark(message: string) {
    if (!id) return;
    const on = !bookmarked.has(message);
    void setBookmark(store, id, message, on).then((saved) => saved.ok || toast.failed(saved));
    const name = on ? undefined : chat.bookmarks?.find((each) => each.message === message)?.name;
    if (name !== undefined) toast.undoable(`'${name}' ${BOOKMARK}를 해제했어요.`, () => setBookmark(store, id, message, true, name));
  }

  // false: it stays where it is.
  function showBookmark({ message, to }: BookmarkRow): boolean {
    if (!id) return false;
    if (!to.length) {
      searchActions.find([message.id]);
      return true;
    }
    if (busy) {
      toast.show('응답이 끝나면 다른 버전으로 넘어갈 수 있어요.');
      return false;
    }
    setSeeking(message.id);
    for (const { message: above, index } of to) {
      void pickVersion(session, id, above, index).then((saved) => {
        if (saved.ok) return;
        setSeeking(null);
        toast.failed(saved);
      });
    }
    return true;
  }

  function renameBookmark(message: string, name: string) {
    if (id) void nameBookmark(store, id, message, name).then((saved) => saved.ok || toast.failed(saved));
  }

  function rename(name: string) {
    if (!id) return;
    void renameChat(store, id, name).then((saved) => saved.ok || toast.failed(saved));
    setDialog(null);
  }

  return {
    displayPending, displayError, retryDisplay, stuck,
    id,
    item,
    shelf,
    card,
    route,
    prompt,
    persona,
    note: chat.note,
    cast: chat.cast ?? [],
    toggles,
    toggleOwner: chat.character,
    notUsed: card && describeUnused(unused(card)),
    messages,
    texts,
    view,
    decor: { bot, css: bot ? resolveAssets(css, url) : '', url, buttons: scripted ? ('live' as const) : ('inert' as const) },
    ...status,
    infoPick,
    translate,
    sendLanguage,
    translation,
    translating,
    illustrate,
    stage,
    pictures,
    illustrating,
    badges,
    messageTools,
    composerTools,
    placed,
    reshaping,
    awaited,
    flipped,
    opening,
    last,
    busy,
    cache,
    leaving,
    found,
    search,
    problem,
    editing,
    pinned,
    branching,
    panel,
    cacheShown: cacheShown(panels, pairs),
    tools,
    bookmarked,
    dialog,
    modelMenu,
    castMenu,
    draft,
    scroll,
    actions: {
      ...searchActions,
      ...statusActions,
      ...editActions,
      send,
      answer: () => ask({ kind: 'answer' }),
      retryRegex,
      stop: () => talk.stop(chatId),
      regenerate: (message: Shown) => ask({ kind: 'regenerate', message: message.id }),
      retry: (message: Shown) => ask({ kind: 'retry', message: message.id, version: shown(message).id }),
      continue: (message: Shown) => ask({ kind: 'continue', message: message.id, version: shown(message).id }),
      swipe,
      pick,
      translate: translateMessage,
      flipTranslation,
      setTranslate: setSwitches,
      setOwnTranslate: setOwnSwitches,
      setIllustrate: setIllustrateSwitches,
      setOwnIllustrate: setOwnIllustrateSwitches,
      illustrate: (message: Shown) => draw(message.id, shown(message).id),
      draw,
      dismissIllustration: (message: string) => illustrator.dismiss(message),
      dropPicture,
      reshape: setReshaping,
      copy,
      press: (button: BotButton | null) => void press(button),
      branch,
      bookmark,
      bookmarks: () => flipPanel({ kind: 'bookmarks' }, ({ kind }) => kind === 'bookmarks'),
      lore: () => flipPanel({ kind: 'lore' }, ({ kind }) => kind === 'lore'),
      showBookmark,
      renameBookmark,
      pin: (message: Shown) => setPinned(pinned === message.id ? null : message.id),
      follow,
      info: (reply: string) => {
        setInfoPick(reply);
        open({ kind: 'info' });
      },
      pickInfo: setInfoPick,
      flipToggles: () => flipPanel({ kind: 'toggles' }, ({ kind }) => kind === 'toggles'),
      memory: (record: string | null) => open({ kind: 'memory', record }),
      cache: () => setPanels((current) => flippedCache(current, pairs)),
      closeCache: () => setPanels((current) => ({ ...current, cache: false })),
      tool: (module: string) => flipPanel({ kind: 'tool', module }, (current) => current.kind === 'tool' && current.module === module),
      toolMenu: (module: string, item: string) => runTool(module, (chat) => session.scripts.menu(chat, module, item)),
      toolAction: (module: string, item: string, message: string) => runTool(module, (chat) => session.scripts.action(chat, module, item, message)),
      side: (side: Side) => open(side),
      closePanel: () => setPanels((current) => ({ ...current, panel: null })),
      openDialog: (which: 'rename' | 'reading' | 'persona' | 'prompt' | 'export') => setDialog(which),
      closeDialog: () => setDialog(null),
      pickModel,
      setOwn,
      choosePersona,
      pinPersona: (persona: string | null) => pinPersona(store, chat.character!, persona),
      setCast: changeCast,
      flip,
      writeToggle,
      resetToggles: reset,
      rename,
      drop,
    },
  };
}
