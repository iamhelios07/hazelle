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
import { ChatInspect } from './ChatInspect';
import { ChatComposer } from './ChatComposer';
import { ChatDialogs, ChatHeaderActions, ChatHeading } from './ChatHeader';
import { ChatInfo } from './ChatInfo';
import { ChatLog, speakers } from './ChatLog';
import { ChatLore } from './ChatLore';
import { ChatMemory } from './ChatMemory';
import { ChatMemoryRecord } from './ChatMemoryRecord';
import { ChatSearch } from './ChatSearch';
import { ChatStatusPeek } from './ChatStatus';
import { ChatToggles } from './ChatToggles';
import { useEditBeside } from './editBeside';
import { promptEditor, toggleEditor, type Panel, type Side } from './panels';
import { useChat } from './useChat';

// What the shell draws for a Side: the persona, prompt and character screens are other features, which only the shell composes.
export type SideAt = { open: Side; inUse: string | null; onOpen: (open: Panel) => void; onClose: () => void };

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
    actions.hold(!chat.held);
  });
  useShortcut('find', () => actions.openSearch());
  // Ctrl+U is held even in a chat not saved yet, where it opens nothing: passed on, it is the browser's view-source.
  useShortcut('inspect', () => {
    if (chat.inspect) actions.closeInspect();
    else if (chat.id !== null) actions.openInspect('request');
  });
  const inUse = prompt.kind === 'prompt' ? prompt.prompt.id : null;
  const inspect = chat.inspect && chat.id !== null && <ChatInspect chat={chat.id} tab={chat.inspect.tab} notes={chat.sendNotes} messages={chat.messages} busy={busy} prompt={prompt} character={shelf?.id ?? null} onTab={actions.switchInspectTab} onClose={actions.closeInspect} onEdit={actions.side} />;
  const paired = usePanelsBeside() && !!panel && !!chat.inspect;
  useEffect(() => {
    onPaired(paired);
    return () => onPaired(false);
  }, [paired, onPaired]);
  return (
    <>
      <ChatFrame
        back={back ? { label: back.label, onClick: () => navigate(back.to) } : undefined}
        title={chat.search ? <ChatSearch search={chat.search} onSearch={actions.searchFor} onStep={actions.stepSearch} onClose={actions.closeSearch} /> : <ChatHeading chat={chat} />}
        actions={<ChatHeaderActions chat={chat} />}
        above={scroll.pill && <Pill label={scroll.pill} live={busy} onClick={actions.follow} />}
        footer={<ChatComposer chat={chat} folded={folded} />}
        panel={
          panel?.kind === 'toggles' ? (
            <ChatToggles card={chat.card} toggles={chat.toggles} toggleOwner={chat.toggleOwner} onFlip={actions.flip} onWrite={actions.writeToggle} onReset={actions.resetToggles} onEdit={(section) => actions.side(toggleEditor(section))} onClose={actions.closePanel} />
          ) : panel?.kind === 'info' ? (
            <ChatInfo id={id} shelf={shelf} messages={chat.messages} infoPick={chat.infoPick} tab={panel.tab} onTab={actions.switchInfoTab} onPick={actions.pickInfo} onRecord={chat.features.memory ? actions.memory : undefined} onEdit={actions.side} onClose={actions.closePanel} />
          ) : panel?.kind === 'memory' ? (
            chat.item && <ChatMemory
              record={panel.record}
              item={chat.item}
              messages={chat.messages}
              busy={busy}
              onClose={actions.closePanel}
              onTool={actions.tool}
              onEditPrompt={prompt.kind === 'prompt' ? () => actions.side({ kind: 'prompts', id: prompt.prompt.id, pane: null }) : undefined}
              onEditTaskPrompt={(door) => actions.side(promptEditor(door))}
              onRecord={actions.memory}
              renderRecord={(record) => <ChatMemoryRecord {...record} actions={actions} />}
            />
          ) : panel?.kind === 'bookmarks' ? (
            chat.item && <ChatBookmarks item={chat.item} messages={chat.messages} texts={chat.texts} names={speakers(chat)} onShow={actions.showBookmark} onUnmark={actions.bookmark} onRename={actions.renameBookmark} onClose={actions.closePanel} />
          ) : panel?.kind === 'lore' ? (
            id && <ChatLore id={id} onClose={actions.closePanel} />
          ) : panel?.kind === 'tool' ? (
            id && <ChatToolPanel key={panel.module} chat={id} module={panel.module} onClose={actions.closePanel} />
          ) : panel ? (
            side({ open: panel, inUse, onOpen: actions.side, onClose: actions.closePanel })
          ) : (
            inspect
          )
        }
        beside={panel && inspect}
        peek={
          <SidePeeks>
            {chat.peeking && <ChatStatusPeek status={chat.status} held={chat.held} decor={chat.decor} onHold={actions.hold} onPress={actions.press} onUnmark={(script) => actions.markStatus(script, false)} />}
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
