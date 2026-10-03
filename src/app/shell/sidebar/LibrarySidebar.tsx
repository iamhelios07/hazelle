import { useMemo, useState } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { CharacterShelf, FolderTree, Shelf } from '../../../model/library';
import { shelfName } from '../../library/shelf';
import { usePersisted } from '../../common/usePersisted';
import { useCharacter, useChatSummary, useLibrary, useWritingChat } from '../../session';
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

// Inside a character, "모든 캐릭터" goes back up without leaving the open chat. The search and the open folders outlast a
// visit inside one.
export function LibrarySidebar({ page, collapsed, onCollapse }: Props) {
  const { none, folders, byFolder, loose } = useLibrary();
  const writing = useWritingChat();
  const route = useRoute();
  const chat = useChatSummary(route.kind === 'chat' ? route.id : null);
  const at = href(route);
  const wide = useWide();
  const [query, setQuery] = useState('');
  // The path at which the user went up to every character. Moving to another page comes back down.
  const [upAt, setUpAt] = useState<string | null>(null);
  if (upAt !== null && upAt !== at) setUpAt(null);
  const [openFolders, setOpenFolders] = usePersisted(OPEN_FOLDERS, openFolderIds, []);

  // The rail keeps every face in one place: folders as the tree shows them, names in order inside each, loose ones
  // last. Not recency, which the panel shows (user ruling, 2026-10-04).
  const railShelves = useMemo(() => {
    const byName = (shelves: CharacterShelf<ChatSummary>[]) => [...shelves].sort((a, b) => shelfName(a).localeCompare(shelfName(b), 'ko'));
    const result: Shelf<ChatSummary>[] = [];
    const visit = (folder: FolderTree) => {
      folder.children.forEach(visit);
      result.push(...byName(byFolder.get(folder.id)!.direct));
    };
    folders.forEach(visit);
    result.push(...byName(loose), none);
    return result;
  }, [folders, byFolder, loose, none]);

  const here = shelfOf(route, chat?.chat.character);
  const character = useCharacter(here ?? null);
  const current = here === null ? none : (character ?? undefined);
  const typing = (shelf: Shelf<ChatSummary>) => shelf.chats.some((item) => item.id === writing);

  // Picking a character goes inside it, even when its latest chat is the page already open.
  const enter = (shelf: Shelf<ChatSummary>) => {
    setUpAt(null);
    navigate(enterShelf(shelf, wide));
  };

  const panel = current && upAt !== at
    ? <ShelfChats key={current.id ?? 'none'} page={page} shelf={current} onUp={() => (page ? navigate(HOME) : setUpAt(at))} />
    : <CharacterTree
      page={page}
      current={current}
      typing={typing}
      onEnter={enter}
      query={query}
      onQuery={setQuery}
      openFolders={openFolders}
      onToggleFolder={(id) => setOpenFolders(openFolders.includes(id) ? openFolders.filter((open) => open !== id) : [...openFolders, id])}
    />;
  if (page) return panel;
  return (
    <>
      <SidebarRail shelves={railShelves} current={current} typing={typing} onEnter={enter} open={!collapsed} onToggle={() => onCollapse(!collapsed)} />
      {!collapsed && panel}
    </>
  );
}
