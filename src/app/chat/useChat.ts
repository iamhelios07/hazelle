import { useEffect, useState } from 'react';
import type { Assignment, ModelRef } from '../../connectors/assignment';
import { unused } from '../../engine/pipeline';
import { shown, type Chat, type ChatItem } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { chatModel, setChatModel } from '../../runtime/assignment';
import { editMessage, removeChat, removeMessage, renameChat, restoreChat, restoreMessage, selectVersion, startChat } from '../../runtime/chat-log';
import { withTurn, type Shown, type TalkFailure } from '../../runtime/talk';
import { scopeOf, takeTurn, type Target } from '../../runtime/turn';
import { describeTalkFailure } from '../common/failure';
import { describeUnused } from '../common/unused';
import { useLoreCount, useSession, useTurn } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { useMenuHandle } from '../ui';
import { useDraft } from './useDraft';
import { useFollow } from './useFollow';

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
  const [draftModels, setDraftModels] = useState<Assignment>({});
  const chat: Chat = item?.chat ?? { title: null, character: shelf?.id ?? null, models: draftModels };
  const route = chatModel(store, chat);
  const scope = scopeOf(session, chat);
  const card = shelf?.character.card ?? null;
  const lore = useLoreCount(chat.character);
  const [greeting, setGreeting] = useState(0);
  const [openedAt] = useState(() => Date.now());
  // A blank greeting keeps its place in the card, but a chat never opens on nothing.
  const greetings = card?.greetings.filter((text) => text.trim()) ?? [];
  const opening: Shown | null =
    item === null && card && greetings.length > 0
      ? {
          id: 'opening',
          role: 'assistant',
          at: openedAt,
          versions: greetings.map((text, index) => ({ id: `opening-${index}`, text, receipt: null, edited: false, at: openedAt })),
          selected: greeting,
          live: null,
        }
      : null;
  const messages: Shown[] = opening ? [opening] : withTurn(item?.messages ?? [], turn, id ?? '');
  const busy = turn !== null;
  const streaming = busy && turn.chat === id;
  const last = messages.at(-1);

  const draft = useDraft(id, chat.character);
  const { follow: toBottom, ...scroll } = useFollow(messages.length, streaming);
  const [dialog, setDialog] = useState<'keys' | 'rename' | null>(null);
  const modelMenu = useMenuHandle();
  const [panel, setPanel] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // A reply starting here while 정보 is open shows its own information.
  const replyTarget = streaming ? (turn.reply.message ?? turn.reply.id) : null;
  useEffect(() => {
    if (replyTarget) setPanel((current) => (current.open ? { open: true, id: replyTarget } : current));
  }, [replyTarget]);

  function report(failure: TalkFailure | null) {
    if (!failure) return;
    toast.show(describeTalkFailure(failure), failure.kind === 'unsaved' ? { label: '다시 저장', onClick: () => void talk.saveAgain().then(report) } : undefined);
  }

  // Back to the foot of the story, which also puts away tools a tap pinned open.
  function follow() {
    toBottom();
    setPinned(null);
  }

  async function send() {
    const text = draft.text.trim();
    if (!text || busy) return;
    if ('kind' in route) {
      setProblem(describeTalkFailure(route));
      return;
    }
    setProblem(null);
    draft.set('');
    follow();
    let chatId = id;
    if (chatId === null) {
      const started = await startChat(store, chat, opening && { texts: opening.versions.map((version) => version.text), selected: opening.selected });
      if (!started.ok) {
        draft.set(text);
        toast.failed(started.failure, started.step === 'chat' ? '채팅을 만들지 못했어요.' : '첫인사를 저장하지 못했어요.');
        return;
      }
      chatId = started.id;
      navigate({ kind: 'chat', id: chatId }, { replace: true });
    }
    const failure = await takeTurn(session, chatId, { kind: 'send', text });
    if (failure?.kind === 'unsent') draft.putBack(chatId, text);
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

  function pickModel(ref: ModelRef) {
    setProblem(null);
    if (!id) {
      setDraftModels({ ...draftModels, main: ref });
      return;
    }
    void setChatModel(store, id, ref).then((saved) => saved.ok || toast.failed(saved));
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
    scope,
    notUsed: card && describeUnused(unused(card, lore)),
    messages,
    opening,
    last,
    busy,
    streaming,
    problem,
    editing,
    pinned,
    panel,
    dialog,
    modelMenu,
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
      pin: (message: Shown) => setPinned(pinned === message.id ? null : message.id),
      follow,
      info: (reply: string | null) => setPanel({ open: true, id: reply }),
      closeInfo: () => setPanel({ open: false, id: null }),
      openDialog: (which: 'keys' | 'rename') => setDialog(which),
      closeDialog: () => setDialog(null),
      pickModel,
      rename,
      drop,
    },
  };
}
