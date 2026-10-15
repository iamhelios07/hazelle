import { useEffect, useMemo, useState } from 'react';
import { resolveAssets } from '../../engine/assets';
import { holdsPersona, unused } from '../../engine/pipeline';
import type { Card } from '../../engine/import/types';
import { shown, type ChatItem, type ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { resetToggles, setToggle } from '../../runtime/characters';
import { chatTranslate, featuresOf } from '../../runtime/features';
import { removeChat, renameChat, restoreChat } from '../../runtime/chat-log';
import { branchFrom, pickVersion } from '../../runtime/message-acts';
import { badgesByVersion, toolActions, toolComposer } from './toolMenu';
import { triggersOf } from '../../runtime/scripts';
import type { Shown } from '../../runtime/talk';
import { blocked, isBlocked, type Target } from '../../runtime/turn-context';
import { packsOf, togglesOf } from '../../runtime/chat-context';
import { takeTurn, type TurnFailure } from '../../runtime/turn';
import type { PersonaChoice } from '../../runtime/personas';
import type { PromptChoice } from '../../runtime/prompts';
import { describeTurnFailure } from '../common/failure';
import { NO_PERSONA_SLOT } from '../common/prompt-words';
import { describeUnused } from '../common/unused';
import { useCopy } from '../common/useCopy';
import { BIN_KEEPS, LORE_BUDGET_LABEL, PAGES } from '../common/words';
import { useAssetUrl, useChatDisplay, useChatMemory, useChatTools, useChildren, useSaves, useSession, useSettings, useStored, useTurn } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { useMenuHandle, usePanelsBeside, useViewport, type BotButton, type Reading } from '../ui';
import { inspectShown, NO_PANELS, opened, type InspectTab, type Panel, type Panels } from './panels';
import { useSendNotes } from './useSendNotes';
import { useDraft } from './useDraft';
import { pickStarted } from './infoReply';
import { toggleRows, toggleSaveKey } from './toggles';
import { useFollow } from './useFollow';
import { useChatSearch } from './useChatSearch';
import { useChatStatus } from './useChatStatus';
import { useMessageEdit } from './useMessageEdit';
import { useNewChat } from './useNewChat';
import { useChatBookmarks } from './useChatBookmarks';
import { useChatIllustrations } from './useChatIllustrations';
import { useChatTranslation } from './useChatTranslation';
import { useChatSettings } from './useChatSettings';

// The chats told this session that a reply's lorebook entries went past the 로어북 최대 분량: each is told once.
const cutTold = new Set<string>();

export type OpenChat = ReturnType<typeof useChat>;

// One actions object flows only between the hubs: ChatScreen, ChatComposer, ChatHeader, ChatLog, ChatMessage and
// ChatMemoryRecord. Leaves receive only the data and callbacks they use; hubs wire those callbacks to action entries.
export type ChatActions = OpenChat['actions'];

// item null is a new chat, saved under chatId with its first message; shelf null is 캐릭터 없이.
export function useChat(chatId: string, item: ChatItem | null, shelf: CharacterShelf<ChatSummary> | null, reply: Reading['reply']) {
  const session = useSession();
  const { store, talk, drafts } = session;
  const saves = useSaves();
  const turn = useTurn(chatId);
  const toast = useToast();
  const copy = useCopy();
  const id = item ? chatId : null;
  const tools = useChatTools(id);
  useEffect(() => {
    if (!id) return;
    void session.tools.warm(id);
    session.scripts.claims(id);
  }, [id, tools]);
  const { chat, route, prompt, persona, actions: settingActions } = useChatSettings(id, item?.chat ?? null, shelf?.id ?? null);
  const toggles = toggleRows(togglesOf(store, chat, prompt));
  const card = shelf?.character.card ?? null;
  // Any trigger may answer a press: a Lua one by a function of the button's name, a block one by its own name.
  const scripted = triggersOf(packsOf(store, chat)).length > 0;
  // Subscribed for featuresOf and chatTranslate, which read the settings and the chat's prompt from the store.
  useSettings();
  useStored('prompt', prompt.kind === 'prompt' ? prompt.prompt.id : null);
  const features = featuresOf(store, chat);
  const translate = chatTranslate(store, chat);
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
  const { actions: translationActions, ...translation } = useChatTranslation(chatId, chat, messages, texts, translate);
  const { actions: illustrationActions, ...illustration } = useChatIllustrations(chatId, id, chat);
  const toolData = useChildren('toolchat', id);
  const badges = useMemo(() => badgesByVersion(toolData, tools), [toolData, tools]);
  const messageTools = useMemo(() => toolActions(tools), [tools]);
  const composerTools = useMemo(() => toolComposer(tools), [tools]);
  const busy = turn !== null;
  const last = messages.at(-1);

  const replyTarget = busy ? (turn.reply.message ?? turn.reply.id) : null;
  // 이어 쓰기 answers none, since it goes on under text already read.
  const replyAt = messages.findIndex((message) => message.id === replyTarget);
  const answered = busy && replyAt > 0 && !turn.reply.continues ? messages[replyAt - 1]!.id : null;

  const draft = useDraft(id, chat.character);
  const { follow: toBottom, beforeTurn, seekTo, ...scroll } = useFollow(messages.length, busy, answered, reply === 'stay');
  const memory = useChatMemory(id);
  const sendNotes = useSendNotes(id, chat, messages, memory, draft.text, busy || displayPending === true);
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
  const [pinned, setPinned] = useState<string | null>(null);
  const [branching, setBranching] = useState(false);
  const { found, search, actions: searchActions } = useChatSearch(messages, texts, translation.translating, translation.flipped, seekTo);
  const { bookmarked, actions: bookmarkActions } = useChatBookmarks(id, chat.bookmarks, messages, busy, searchActions.find);
  const { actions: statusActions, ...status } = useChatStatus(chat, shelf?.character ?? null, view, messages);
  const { editing, actions: editActions } = useMessageEdit(id, messages, (message) => ask({ kind: 'regenerate', message: message.id }), translationActions.carryFlip);
  // Set when a send or a reply was stopped before the network; the composer then shows what stops the chat now,
  // so a fix made anywhere clears it.
  const [stopped, setStopped] = useState(false);
  const problem = stopped ? blocked(session, chat) : null;

  useEffect(() => {
    if (id) session.memory.check(id);
  }, [id, features.memory]);
  useEffect(() => {
    if (!features.memory) setPanels((current) => (current.panel?.kind === 'memory' ? { ...current, panel: null } : current));
  }, [features.memory]);

  // Only a reply this page asked for has what it sent (runtime/talk sent), so it is told the moment that reply lands.
  const lastReply = messages.findLast((message) => message.role === 'assistant');
  const lastCall = lastReply && shown(lastReply).receipt?.id;
  useEffect(() => {
    if (!lastReply || !lastCall || cutTold.has(chatId)) return;
    const cut = talk.sent(lastCall)?.prompt.lore?.filter(({ fate }) => fate.kind === 'dropped' && fate.cause === 'budget').length ?? 0;
    if (cut === 0) return;
    cutTold.add(chatId);
    toast.show(`켜진 로어북 항목 중 ${cut}개가 빠졌어요`, {
      detail: card !== null && card.loreSettings.tokenBudget !== null
        ? `이 캐릭터의 ${LORE_BUDGET_LABEL}을 넘었어요. 캐릭터 편집 › 로어북에서 늘릴 수 있어요.`
        : `${LORE_BUDGET_LABEL}을 넘었어요. 설정 › ${PAGES.chat}에서 늘릴 수 있어요.`,
      action: { label: '정보 보기', onClick: () => { setInfoPick(lastReply.id); open({ kind: 'info' }); } },
    });
  }, [lastCall]);

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
    personaNote: personaNote(card, prompt, persona),
    messages,
    texts,
    view,
    decor: { bot, css: bot ? resolveAssets(css, url) : '', url, buttons: scripted ? ('live' as const) : ('inert' as const) },
    ...status,
    infoPick,
    features,
    translate,
    ...translation,
    ...illustration,
    badges,
    messageTools,
    composerTools,
    placed,
    opening,
    last,
    busy,
    sendNotes,
    found,
    search,
    problem,
    editing,
    pinned,
    branching,
    panel,
    inspect: inspectShown(panels, pairs),
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
      ...translationActions,
      ...illustrationActions,
      ...bookmarkActions,
      ...settingActions,
      send,
      answer: () => ask({ kind: 'answer' }),
      retryRegex,
      stop: () => talk.stop(chatId),
      regenerate: (message: Shown) => ask({ kind: 'regenerate', message: message.id }),
      retry: (message: Shown) => ask({ kind: 'retry', message: message.id, version: shown(message).id }),
      continue: (message: Shown) => ask({ kind: 'continue', message: message.id, version: shown(message).id }),
      swipe,
      pick,
      copy,
      press: (button: BotButton | null) => void press(button),
      branch,
      bookmarks: () => flipPanel({ kind: 'bookmarks' }, ({ kind }) => kind === 'bookmarks'),
      lore: () => flipPanel({ kind: 'lore' }, ({ kind }) => kind === 'lore'),
      pin: (message: Shown) => setPinned(pinned === message.id ? null : message.id),
      follow,
      info: (reply: string) => {
        setInfoPick(reply);
        open({ kind: 'info' });
      },
      pickInfo: setInfoPick,
      flipToggles: () => flipPanel({ kind: 'toggles' }, ({ kind }) => kind === 'toggles'),
      memory: (record: string | null) => open({ kind: 'memory', record }),
      openInspect: (tab: InspectTab) => open({ kind: 'inspect', tab }),
      switchInspectTab: (tab: InspectTab) => setPanels((current) => current.inspect ? { ...current, inspect: { kind: 'inspect', tab } } : current),
      closeInspect: () => setPanels((current) => ({ ...current, inspect: null })),
      tool: (module: string) => flipPanel({ kind: 'tool', module }, (current) => current.kind === 'tool' && current.module === module),
      toolMenu: (module: string, item: string) => runTool(module, (chat) => session.scripts.menu(chat, module, item)),
      toolAction: (module: string, item: string, message: string) => runTool(module, (chat) => session.scripts.action(chat, module, item, message)),
      side: (panel: Panel) => open(panel),
      closePanel: () => setPanels((current) => ({ ...current, panel: null })),
      openDialog: (which: 'rename' | 'reading' | 'persona' | 'prompt' | 'export') => setDialog(which),
      closeDialog: () => setDialog(null),
      flip,
      writeToggle,
      resetToggles: reset,
      rename,
      drop,
    },
  };
}

// A missing prompt or persona stops the turn on its own; a utility card leaves the persona out as Risu does.
function personaNote(card: Card | null, prompt: PromptChoice, persona: PersonaChoice): string | null {
  if (card?.utility || prompt.kind !== 'prompt' || persona.kind !== 'persona') return null;
  if (!holdsPersona(prompt.prompt.value.blocks)) return NO_PERSONA_SLOT;
  return persona.persona.value.description.trim() ? null : '페르소나 설명이 비어 있어요.';
}
