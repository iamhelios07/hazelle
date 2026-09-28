import type { ChatItem } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { ToastSlot } from '../toast';
import { ChatFrame, Pill } from '../ui';
import { ChatComposer } from './ChatComposer';
import { ChatDialogs, ChatHeaderActions, ChatHeading } from './ChatHeader';
import { ChatInfo } from './ChatInfo';
import { ChatLog } from './ChatLog';
import { ChatToggles } from './ChatToggles';
import { useChat } from './useChat';

type Props = {
  // null for a new chat, which is saved with its first message.
  item: ChatItem | null;
  // The chat's character, or null for 캐릭터 없이.
  shelf: CharacterShelf<ChatItem> | null;
  back: Back | null;
};

// design F3.
export function ChatScreen({ item, shelf, back }: Props) {
  const chat = useChat(item, shelf);
  const { id, messages, streaming, panel, scroll, actions } = chat;
  return (
    <>
      <ChatFrame
        back={back ? { label: back.label, onClick: () => navigate(back.to) } : undefined}
        title={<ChatHeading chat={chat} />}
        actions={<ChatHeaderActions chat={chat} />}
        above={
          <>
            {scroll.pill && <Pill label={scroll.pill} live={streaming} onClick={actions.follow} />}
            <ToastSlot />
          </>
        }
        footer={<ChatComposer chat={chat} />}
        panel={
          panel?.kind === 'info' ? (
            <ChatInfo chat={id} messages={messages} id={panel.id} onShow={actions.info} onClose={actions.closePanel} />
          ) : (
            panel?.kind === 'toggles' && <ChatToggles chat={chat} />
          )
        }
        scrollRef={scroll.scrollRef}
        onScroll={scroll.onScroll}
      >
        <ChatLog chat={chat} />
      </ChatFrame>
      <ChatDialogs chat={chat} />
    </>
  );
}
