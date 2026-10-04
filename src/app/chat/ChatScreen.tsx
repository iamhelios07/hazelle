import type { ReactNode } from 'react';
import type { ChatItem, ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useShortcut } from '../shortcuts';
import { useDisplay } from '../display';
import { ChatFrame, Pill, SidePeeks } from '../ui';
import { ChatComposer } from './ChatComposer';
import { ChatDialogs, ChatHeaderActions, ChatHeading } from './ChatHeader';
import { ChatInfo } from './ChatInfo';
import { ChatLog } from './ChatLog';
import { ChatMemory } from './ChatMemory';
import { ChatStatusAside, ChatStatusPeek } from './ChatStatus';
import { ChatToggles } from './ChatToggles';
import { useChat, type Side } from './useChat';

// What the shell draws for a Side: the persona, prompt and character screens are other features, which only the shell composes.
export type SideAt = { open: Side; inUse: string | null; onOpen: (open: Side) => void; onClose: () => void };

type Props = {
  // The chat's id, which a new chat is saved under.
  id: string;
  // null for a new chat, which is saved with its first message.
  item: ChatItem | null;
  // The chat's character, or null for 캐릭터 없이.
  shelf: CharacterShelf<ChatSummary> | null;
  back: Back | null;
  side: (at: SideAt) => ReactNode;
};

export function ChatScreen({ id: chatId, item, shelf, back, side }: Props) {
  const { reading, display } = useDisplay();
  const chat = useChat(chatId, item, shelf, reading.reply);
  const { id, streaming, panel, scroll, prompt, persona, actions } = chat;
  const folded = display.foldComposer && scroll.away;
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
        actions={<ChatHeaderActions chat={chat} />}
        above={scroll.pill && <Pill label={scroll.pill} live={streaming} onClick={actions.follow} />}
        footer={<ChatComposer chat={chat} folded={folded} />}
        panel={
          panel?.kind === 'toggles' ? (
            <ChatToggles chat={chat} />
          ) : panel?.kind === 'memory' ? (
            // The panel opens only from a saved chat.
            id && <ChatMemory id={id} record={panel.record} chat={chat} />
          ) : (
            panel && side({ open: panel, inUse: inUse[panel.kind], onOpen: actions.side, onClose: actions.closePanel })
          )
        }
        peek={
          <SidePeeks>
            {chat.peeking && <ChatStatusPeek chat={chat} />}
            <ChatInfo chat={chat} />
          </SidePeeks>
        }
        aside={chat.status.length > 0 && <ChatStatusAside chat={chat} />}
        reading={reading}
        hideHeader={display.hideHeader}
        pictures={shelf?.character.pictures}
        compact={folded}
        scrollRef={scroll.scrollRef}
        onScroll={scroll.onScroll}
      >
        <ChatLog chat={chat} />
      </ChatFrame>
      <ChatDialogs chat={chat} />
    </>
  );
}
