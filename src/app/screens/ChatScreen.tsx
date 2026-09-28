import { MessageSquare, MoreHorizontal, PanelRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Assignment, ModelRef } from '../../connectors/assignment';
import { unused } from '../../engine/pipeline';
import { render } from '../../engine/render';
import { shown, type Chat } from '../../model/chat';
import { KEEP_DAYS } from '../../model/library';
import { chatModel, setChatModel } from '../../runtime/assignment';
import { editMessage, removeChat, removeMessage, renameChat, restoreChat, restoreMessage, selectVersion, startChat } from '../../runtime/chat-log';
import { withTurn, type Shown, type TalkFailure } from '../../runtime/talk';
import { scopeOf, takeTurn, type Target } from '../../runtime/turn';
import { navigate } from '../router';
import { useCharacter, useChat, useLoreCount, useSession, useTurn } from '../session';
import { ToastSlot, useToast } from '../toast';
import {
  Avatar,
  Button,
  Callout,
  ChatFrame,
  ChatTitle,
  Composer,
  Dialog,
  Divider,
  IconButton,
  MenuItem,
  Pill,
  Popover,
  SendButton,
  Shortcuts,
  Text,
  useWide,
} from '../ui';
import { ChatInfo } from './ChatInfo';
import { ChatMessage } from './ChatMessage';
import { ChatModelMenu } from './ChatModelMenu';
import { describeFailure, describeTalkFailure } from './failure';
import { NameDialog } from './NameDialog';
import { shelfPath } from './shelves';
import { describeUnused } from './unused';
import { day } from './time';

// Unsent text per chat, kept while the page is open. A new chat's is kept under NEW.
const drafts = new Map<string, string>();
const NEW = 'new';

const SHORTCUTS = [
  { label: '보내기', keys: ['Enter'] },
  { label: '줄바꿈', keys: ['Shift', 'Enter'] },
  { label: '답장 멈추기', keys: ['Esc'] },
  { label: '내 마지막 메시지 수정', keys: ['↑'] },
  { label: '답장 넘기기 · 끝에서 새로 받기', keys: ['←', '→'] },
  { label: '수정 저장', keys: ['Ctrl', 'Enter'] },
  { label: '수정 취소', keys: ['Esc'] },
];

// design F3. id is null for a new chat, which is saved with its first message.
export function ChatScreen({ id, character }: { id: string | null; character: string | null }) {
  const session = useSession();
  const { store, talk } = session;
  const turn = useTurn();
  const wide = useWide();
  const toast = useToast();
  const item = useChat(id);
  const [draftModels, setDraftModels] = useState<Assignment>({});
  const chat: Chat = item?.chat ?? { title: null, character, models: draftModels };
  const route = chatModel(store, chat);
  const scope = scopeOf(session, chat);
  const shelf = useCharacter(chat.character);
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
  const draftKey = id ?? (character ? `${NEW}-${character}` : NEW);

  const [draft, setDraftState] = useState(() => drafts.get(draftKey) ?? '');
  const [pop, setPop] = useState<'model' | 'menu' | null>(null);
  const [dialog, setDialog] = useState<'keys' | 'rename' | null>(null);
  const [panel, setPanel] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  const busy = turn !== null;
  const streaming = busy && turn.chat === id;
  const last = messages.at(-1);
  const seen = useRef({ count: messages.length, streaming });

  const setDraft = (text: string) => {
    drafts.set(draftKey, text);
    setDraftState(text);
  };

  // The view follows the story while it is at the bottom; scrolled up, it stays, and a new message
  // lights the 새 답장 pill instead.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
    const ended = seen.current.streaming && !streaming;
    if ((messages.length > seen.current.count || ended) && !stick.current) setUnread(true);
    seen.current = { count: messages.length, streaming };
  });

  // A reply starting here while 정보 is open shows its own information.
  const replyTarget = streaming ? (turn.reply.message ?? turn.reply.id) : null;
  useEffect(() => {
    if (replyTarget) setPanel((current) => (current.open ? { open: true, id: replyTarget } : current));
  }, [replyTarget]);

  function report(failure: TalkFailure | null) {
    if (!failure) return;
    toast({
      message: describeTalkFailure(failure),
      action: failure.kind === 'unsaved' ? { label: '다시 저장', onClick: () => void talk.saveAgain().then(report) } : undefined,
    });
  }

  function follow() {
    stick.current = true;
    setAway(false);
    setUnread(false);
    setPinned(null);
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if ('kind' in route) {
      setProblem(describeTalkFailure(route));
      return;
    }
    setProblem(null);
    setDraft('');
    follow();
    let chatId = id;
    if (chatId === null) {
      const started = await startChat(store, chat, opening && { texts: opening.versions.map((version) => version.text), selected: opening.selected });
      if (!started.ok) {
        setDraft(text);
        toast({ message: `${started.step === 'chat' ? '채팅을 만들지 못했어요.' : '첫인사를 저장하지 못했어요.'} ${describeFailure(started.failure)}` });
        return;
      }
      chatId = started.id;
      navigate(`/chats/${chatId}`, { replace: true });
    }
    const failure = await takeTurn(session, chatId, { kind: 'send', text });
    if (failure?.kind === 'unsent') drafts.set(chatId, text);
    if (failure?.kind === 'unsent' && chatId === id) setDraftState(text);
    report(failure);
  }

  function ask(target: Target) {
    if (!id || busy) return;
    follow();
    void takeTurn(session, id, target).then(report);
  }

  function select(message: Shown, index: number) {
    if (!id) return;
    void selectVersion(store, id, message.id, message.versions[index]!.id).then((saved) => saved.ok || toast({ message: describeFailure(saved) }));
  }

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
    if (!saved.ok) {
      toast({ message: describeFailure(saved) });
      return;
    }
    setEditing(null);
    if (andReply && last && last.role === 'assistant') ask({ kind: 'regenerate', message: last.id });
  }

  async function remove(message: Shown) {
    if (!id) return;
    const chatId = id;
    const saved = await removeMessage(store, chatId, message.id);
    if (!saved.ok) {
      toast({ message: describeFailure(saved) });
      return;
    }
    toast({
      message: '메시지를 지웠어요',
      action: { label: '되돌리기', onClick: () => void restoreMessage(store, chatId, message.id) },
    });
  }

  async function dropChat() {
    if (!item) return;
    if (streaming) talk.stop();
    const removed = await removeChat(store, item.id);
    if (!removed.ok) {
      toast({ message: describeFailure(removed) });
      return;
    }
    const stored = removed.data;
    navigate(shelfPath(stored.value.character));
    toast({
      message: '채팅을 지웠어요',
      action: { label: '되돌리기', onClick: () => void restoreChat(store, stored).then((saved) => saved.ok && navigate(`/chats/${stored.id}`)) },
    });
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ message: '복사했어요' }),
      () => toast({ message: '복사하지 못했어요. 브라우저가 클립보드를 막았어요.' }),
    );
  }

  function pickModel(ref: ModelRef) {
    setProblem(null);
    if (!id) {
      setDraftModels({ ...draftModels, main: ref });
      return;
    }
    void setChatModel(store, id, ref).then((saved) => saved.ok || toast({ message: describeFailure(saved) }));
  }

  async function rename(name: string) {
    if (!id) return;
    const saved = await renameChat(store, id, name);
    if (!saved.ok) toast({ message: describeFailure(saved) });
    else setDialog(null);
  }

  function openDialog(which: 'keys' | 'rename') {
    setPop(null);
    setDialog(which);
  }

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter while a Korean syllable is still being composed must not send it half-typed.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
      return;
    }
    if (event.key === 'Escape' && streaming) {
      event.preventDefault();
      talk.stop();
      return;
    }
    if (draft !== '' || busy) return;
    if (event.key === 'ArrowUp') {
      const mine = messages.findLast((message) => message.role === 'user');
      if (mine) {
        event.preventDefault();
        setEditing({ id: mine.id, text: shown(mine).text });
      }
    } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && last?.role === 'assistant') {
      event.preventDefault();
      swipe(last, event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  function onScroll() {
    const element = scroller.current!;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    stick.current = bottom;
    setAway(!bottom);
    if (bottom) setUnread(false);
  }

  // The character is in 지운 캐릭터, or gone for good.
  const orphaned = chat.character !== null && !shelf;
  if ((id !== null && !item) || orphaned) {
    return (
      <ChatFrame title={<ChatTitle avatar={<Avatar face={MessageSquare} />} title="채팅" typing={false} />} actions={null} above={null} footer={null} scrollRef={scroller} onScroll={() => {}} onBack={wide ? undefined : () => navigate('/')}>
        <Text tone="muted">
          {orphaned ? `지운 캐릭터의 채팅이에요. ${KEEP_DAYS}일 안에는 캐릭터 둘러보기의 ‘지운 캐릭터’에서 되살릴 수 있어요.` : '이 채팅이 없어요. 지워졌거나 주소가 잘못됐어요.'}
        </Text>
      </ChatFrame>
    );
  }

  const title = card ? `${card.name} · ${item?.title ?? '새 채팅'}` : (item?.title ?? '새 채팅');
  const face = card ? <Avatar face={card.name} image={shelf!.face} /> : <Avatar face={MessageSquare} />;
  const notUsed = card && describeUnused(unused(card, lore));
  const modelLabel = 'kind' in route ? '모델 고르기' : route.model.name;
  const currentRef = 'kind' in route ? null : { connection: route.connection.id, model: route.model.id };
  // Key hints only where there is a keyboard to press them.
  const hint = !focused || !wide ? '' : streaming ? 'Esc 멈추기' : draft ? 'Enter 보내기 · Shift+Enter 줄바꿈' : 'Enter 보내기 · ↑ 내 메시지 수정 · ← → 답장 넘기기';

  const rows: ReactNode[] = [];
  if (notUsed) {
    rows.push(
      <Text key="unused" tone="muted" align="center">
        {notUsed}
      </Text>,
    );
  }
  if (messages.length === 0) {
    rows.push(
      <Text key="intro" tone="muted" align="center">
        {card ? '첫인사가 없는 캐릭터예요. 먼저 말을 걸어 보세요.' : '캐릭터 없이 모델과 바로 이야기하는 채팅이에요. 모델은 오른쪽 위 버튼에서 이 채팅만 바꿀 수 있어요.'}
      </Text>,
    );
  }
  let lastDay = '';
  messages.forEach((message, index) => {
    const text = render('display', shown(message).text, scope);
    const label = day(message.at);
    if (label !== lastDay) {
      rows.push(<Divider key={`day-${message.at}`} label={label} />);
      lastDay = label;
    }
    rows.push(
      <ChatMessage
        key={message.id}
        message={message}
        text={text}
        isLast={index === messages.length - 1}
        beforeLastReply={message.role === 'user' && index === messages.length - 2 && last?.role === 'assistant'}
        character={card && { name: card.nickname || card.name, image: shelf!.face }}
        modelName={'kind' in route ? null : route.model.name}
        opening={message === opening}
        busy={busy}
        editing={editing?.id === message.id ? editing.text : null}
        pinned={pinned === message.id}
        onTap={() => setPinned(pinned === message.id ? null : message.id)}
        onEdit={(text) => setEditing(text === null ? null : { id: message.id, text })}
        onSaveEdit={(andReply) => void saveEdit(message, andReply)}
        onSwipe={(step) => swipe(message, step)}
        onRegenerate={() => ask({ kind: 'regenerate', message: message.id })}
        onRetry={() => ask({ kind: 'retry', message: message.id, version: shown(message).id })}
        onOtherModel={() => setPop('model')}
        onCopy={() => copy(text)}
        onInfo={() => setPanel({ open: true, id: message.id })}
        onDelete={() => void remove(message)}
      />,
    );
  });

  return (
    <>
      <ChatFrame
        onBack={wide ? undefined : () => navigate(shelfPath(chat.character))}
        title={<ChatTitle avatar={face} title={title} typing={streaming} />}
        actions={
          <>
            <ChatModelMenu open={pop === 'model'} onOpen={(open) => setPop(open ? 'model' : null)} current={currentRef} label={modelLabel} onPick={pickModel} />
            <IconButton icon={PanelRight} label="답장 정보" size="sm" expanded={panel.open} onClick={() => setPanel({ open: !panel.open, id: null })} />
            <Popover
              open={pop === 'menu'}
              onClose={() => setPop(null)}
              place="below-end"
              label="더보기"
              trigger={<IconButton icon={MoreHorizontal} label="더보기" size="sm" expanded={pop === 'menu'} onClick={() => setPop(pop === 'menu' ? null : 'menu')} />}
            >
              {item && <MenuItem label="채팅 이름 바꾸기" onClick={() => openDialog('rename')} />}
              <MenuItem label="단축키" onClick={() => openDialog('keys')} />
              {item && (
                <>
                  <Divider variant="menu" />
                  <MenuItem
                    label="이 채팅 삭제"
                    tone="warn"
                    onClick={() => {
                      setPop(null);
                      void dropChat();
                    }}
                  />
                </>
              )}
            </Popover>
          </>
        }
        above={
          <>
            {away && <Pill label={streaming ? '답장 쓰는 중' : unread ? '새 답장' : '맨 아래로'} live={streaming} onClick={follow} />}
            <ToastSlot />
          </>
        }
        footer={
          <>
            {problem && <Callout tone="warn">{problem}</Callout>}
            <Composer
              inputRef={input}
              value={draft}
              onChange={setDraft}
              onKeyDown={onKey}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="메시지 · *행동*은 별표로 감싸요"
              hint={hint}
              actions={
                <>
                  {!busy && !draft.trim() && last?.role === 'user' && (
                    <Button variant="ghost" size="sm" onClick={() => ask({ kind: 'answer' })}>
                      답장 받기
                    </Button>
                  )}
                  <SendButton
                    streaming={streaming}
                    disabled={!streaming && (!draft.trim() || busy)}
                    title={streaming ? '멈추기 · Esc' : busy ? '다른 채팅에서 답장을 받는 중이에요' : '보내기 · Enter'}
                    onClick={() => (streaming ? talk.stop() : void send())}
                  />
                </>
              }
            />
          </>
        }
        panel={
          panel.open && <ChatInfo chat={id} messages={messages} id={panel.id} onShow={(reply) => setPanel({ open: true, id: reply })} onClose={() => setPanel({ open: false, id: null })} />
        }
        scrollRef={scroller}
        onScroll={onScroll}
      >
        {rows}
      </ChatFrame>
      {dialog === 'keys' && (
        <Dialog title="단축키" note="입력창에서 동작해요. 화살표는 입력창이 비어 있을 때만 써요." onClose={() => setDialog(null)}>
          <Shortcuts items={SHORTCUTS} />
        </Dialog>
      )}
      {dialog === 'rename' && item && (
        <NameDialog title="채팅 이름 바꾸기" value={item.title} hint="비워 두면 첫 메시지로 불러요." onSave={(name) => void rename(name)} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
