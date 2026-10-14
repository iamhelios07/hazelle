import { ChatToolPanel } from './ChatToolPanel';
import { useEffect, type ReactNode } from 'react';
import type { ChatItem, ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useShortcut } from '../shortcuts';
import { useDisplay } from '../display';
import { ChatFrame, Pill, SidePeeks, usePanelsBeside } from '../ui';
import { ChatBookmarks } from './ChatBookmarks';
import { ChatCachePanel } from './ChatCachePanel';
import { ChatComposer } from './ChatComposer';
import { ChatDialogs, ChatHeaderActions, ChatHeading } from './ChatHeader';
import { ChatInfo } from './ChatInfo';
import { ChatLog } from './ChatLog';
import { ChatLore } from './ChatLore';
import { ChatMemory } from './ChatMemory';
import { ChatSearch } from './ChatSearch';
import { ChatStatusPeek } from './ChatStatus';
import { ChatToggles } from './ChatToggles';
import { useEditBeside } from './editBeside';
import type { Side } from './panels';
import { useChat } from './useChat';

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
  // Told while two panels stand beside the story, so the shell can make room.
  onPaired: (paired: boolean) => void;
};

export function ChatScreen({ id: chatId, item, shelf, back, side, onPaired }: Props) {
  const { reading, display } = useDisplay();
  const chat = useChat(chatId, item, shelf, reading.reply);
  const { id, busy, panel, scroll, prompt, actions } = chat;
  const folded = display.foldComposer && scroll.away;
  useShortcut('personas', () => actions.openDialog('persona'));
  useShortcut('prompts', () => actions.openDialog('prompt'));
  useEditBeside(shelf?.id ?? null, () => shelf && actions.side({ kind: 'character', id: shelf.id, part: null }));
  useShortcut('status', () => {
    if (!chat.status.length) return false;
    actions.toggleStatus();
  });
  useShortcut('find', () => actions.openSearch());
  const inUse = { prompts: prompt.kind === 'prompt' ? prompt.prompt.id : null, character: null };
  const cache = chat.cacheShown && <ChatCachePanel chat={chat} />;
  const paired = usePanelsBeside() && !!panel && chat.cacheShown;
  useEffect(() => {
    onPaired(paired);
    return () => onPaired(false);
  }, [paired, onPaired]);
  return (
    <>
      <ChatFrame
        back={back ? { label: back.label, onClick: () => navigate(back.to) } : undefined}
        title={chat.search ? <ChatSearch search={chat.search} actions={actions} /> : <ChatHeading chat={chat} />}
        actions={<ChatHeaderActions chat={chat} />}
        above={scroll.pill && <Pill label={scroll.pill} live={busy} onClick={actions.follow} />}
        footer={<ChatComposer chat={chat} folded={folded} />}
        panel={
          panel?.kind === 'toggles' ? (
            <ChatToggles chat={chat} />
          ) : panel?.kind === 'info' ? (
            <ChatInfo chat={chat} />
          ) : panel?.kind === 'memory' ? (
            // The panel opens only from a saved chat.
            id && <ChatMemory id={id} record={panel.record} chat={chat} />
          ) : panel?.kind === 'bookmarks' ? (
            id && <ChatBookmarks id={id} chat={chat} />
          ) : panel?.kind === 'lore' ? (
            id && <ChatLore id={id} onClose={actions.closePanel} />
          ) : panel?.kind === 'tool' ? (
            id && <ChatToolPanel key={panel.module} chat={id} module={panel.module} onClose={actions.closePanel} />
          ) : panel ? (
            side({ open: panel, inUse: inUse[panel.kind], onOpen: actions.side, onClose: actions.closePanel })
          ) : (
            cache
          )
        }
        beside={panel && cache}
        peek={
          <SidePeeks>
            {chat.peeking && <ChatStatusPeek chat={chat} />}
          </SidePeeks>
        }
        reading={reading}
        hideHeader={display.hideHeader}
        stage={chat.stage}
        pictures={{ ...shelf?.character.pictures, most: shelf?.character.pictures?.most ?? display.pictureMost }}
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
