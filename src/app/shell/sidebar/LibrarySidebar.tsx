import { useState } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { usePersisted } from '../../common/usePersisted';
import { useChats, useLibrary, useTurn } from '../../session';
import { useWide } from '../../ui';
import { navigate, useRoute } from '../router';
import { enterShelf, HOME, href, shelfOf } from '../routes';
import { CharacterTree } from './CharacterTree';
import { ShelfChats } from './ShelfChats';
import { SidebarRail } from './SidebarRail';

const OPEN_FOLDERS = 'risu-alpha:open-folders';
const openFolderIds = (stored: string): string[] => {
  const open: unknown = JSON.parse(stored);
  return Array.isArray(open) ? open.filter((id) => typeof id === 'string') : [];
};

type Props = {
  // Phones: the list is the home screen.
  page: boolean;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
};

// Inside a character, the list is its chats, and "모든 캐릭터" goes back up without leaving the open chat. The search
// and the open folders outlast a visit inside one.
export function LibrarySidebar({ page, collapsed, onCollapse }: Props) {
  const { characters, none } = useLibrary();
  const chatById = new Map(useChats().map((item) => [item.id, item]));
  const turn = useTurn();
  const route = useRoute();
  const at = href(route);
  const wide = useWide();
  const [query, setQuery] = useState('');
  // The path at which the user went up to every character. Moving to another page comes back down.
  const [upAt, setUpAt] = useState<string | null>(null);
  if (upAt !== null && upAt !== at) setUpAt(null);
  const [openFolders, setOpenFolders] = usePersisted(OPEN_FOLDERS, openFolderIds, []);

  const shelves = [...characters, none];
  const here = shelfOf(route, chatById);
  const current = here === undefined ? undefined : shelves.find((shelf) => shelf.id === here);
  const typing = (shelf: Shelf<ChatSummary>) => shelf.chats.some((item) => item.id === turn?.chat);

  // Picking a character goes inside it, even when its latest chat is the page already open.
  const enter = (shelf: Shelf<ChatSummary>) => {
    setUpAt(null);
    navigate(enterShelf(shelf, wide));
  };

  if (collapsed && !page) return <SidebarRail shelves={shelves} current={current} typing={typing} onEnter={enter} onExpand={() => onCollapse(false)} />;
  const fold = page ? undefined : () => onCollapse(true);
  if (current && upAt !== at) {
    return <ShelfChats page={page} onCollapse={fold} shelf={current} typing={typing} onEnter={enter} onUp={() => (page ? navigate(HOME) : setUpAt(at))} />;
  }
  return (
    <CharacterTree
      page={page}
      onCollapse={fold}
      current={current}
      typing={typing}
      onEnter={enter}
      query={query}
      onQuery={setQuery}
      openFolders={openFolders}
      onToggleFolder={(id) => setOpenFolders(openFolders.includes(id) ? openFolders.filter((open) => open !== id) : [...openFolders, id])}
    />
  );
}
