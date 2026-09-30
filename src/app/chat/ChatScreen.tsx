import type { ReactNode } from 'react';
import type { ChatItem, ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useShortcut } from '../shortcuts';
import { ToastSlot } from '../toast';
import { ChatFrame, Pill } from '../ui';
import { ChatComposer } from './ChatComposer';
import { ChatDialogs, ChatHeaderActions, ChatHeading } from './ChatHeader';
import { ChatInfo } from './ChatInfo';
import { ChatLog } from './ChatLog';
import { useReading } from './ChatReading';
import { ChatStatusAside, ChatStatusPeek } from './ChatStatus';
import { ChatToggles } from './ChatToggles';
import { useChat, type Side } from './useChat';

// What the shell draws for a Side: the persona, prompt and character screens are other features, which only the shell composes.
// inUse is the one this chat uses, marked in the list.
export type SideAt = { open: Side; inUse: string | null; onOpen: (open: Side) => void; onClose: () => void };

type Props = {
  // null for a new chat, which is saved with its first message.
  item: ChatItem | null;
  // The chat's character, or null for 캐릭터 없이.
  shelf: CharacterShelf<ChatSummary> | null;
  back: Back | null;
  side: (at: SideAt) => ReactNode;
};

export function ChatScreen({ item, shelf, back, side }: Props) {
  const chat = useChat(item, shelf);
  const reading = useReading();
  const { id, messages, streaming, panel, scroll, prompt, persona, actions } = chat;
  useShortcut('personas', () => actions.toggleSide('personas'));
  useShortcut('prompts', () => actions.toggleSide('prompts'));
  useShortcut('status', () => {
    if (!chat.status.length) return false;
    actions.toggleStatus();
  });
  const inUse = { personas: persona.kind === 'persona' ? persona.persona.id : null, prompts: prompt.kind === 'prompt' ? prompt.prompt.id : null, character: null };
  return (
    <>
      <ChatFrame
        back={back ? { label: back.label, onClick: () => navigate(back.to) } : undefined}
        title={<ChatHeading chat={chat} />}
        actions={<ChatHeaderActions chat={chat} reading={reading} />}
        above={scroll.pill && <Pill label={scroll.pill} live={streaming} onClick={actions.follow} />}
        notice={<ToastSlot />}
        footer={<ChatComposer chat={chat} />}
        panel={
          panel?.kind === 'info' ? (
            <ChatInfo chat={id} messages={messages} id={panel.id} onShow={actions.info} onClose={actions.closePanel} />
          ) : panel?.kind === 'toggles' ? (
            <ChatToggles chat={chat} />
          ) : (
            panel && side({ open: panel, inUse: inUse[panel.kind], onOpen: actions.side, onClose: actions.closePanel })
          )
        }
        peek={chat.peeking && <ChatStatusPeek chat={chat} />}
        aside={chat.status.length > 0 && <ChatStatusAside chat={chat} />}
        reading={reading.value}
        compact={scroll.away}
        scrollRef={scroll.scrollRef}
        onScroll={scroll.onScroll}
      >
        <ChatLog chat={chat} />
      </ChatFrame>
      <ChatDialogs chat={chat} reading={reading} />
    </>
  );
}
