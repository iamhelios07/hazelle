import { useMemo, useState } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { CharacterShelf, FolderTree, Shelf } from '../../../model/library';
import { shelfName } from '../../library/shelf';
import { usePersisted } from '../../common/usePersisted';
import { useCharacter, useChatSummary, useLibrary, useWritingChats } from '../../session';
import { useWide } from '../../ui';
import { navigate, useRoute } from '../router';
import { enterShelf, shelfOf } from '../routes';
import { CharacterTree } from './CharacterTree';
import { ShelfChats } from './ShelfChats';
import { SidebarRail } from './SidebarRail';

const OPEN_FOLDERS = 'risu-alpha:open-folders';
const openFolderIds = (stored: string): string[] => {
  const open: unknown = JSON.parse(stored);
  return Array.isArray(open) ? open.filter((id) => typeof id === 'string') : [];
};

type Props = {
  page: boolean;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
};

// Wide screens: the rail beside a character's chats, and the rail alone elsewhere, since 캐릭터 둘러보기 holds every
// character (user ruling, 2026-10-11). Phones: the list of characters is the home page. Its search and open folders
// outlast a visit inside one.
export function LibrarySidebar({ page, collapsed, onCollapse }: Props) {
  const { none, folders, byFolder, loose } = useLibrary();
  const writing = useWritingChats();
  const route = useRoute();
  const chat = useChatSummary(route.kind === 'chat' ? route.id : null);
  const wide = useWide();
  const [query, setQuery] = useState('');
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
  const typing = (shelf: Shelf<ChatSummary>) => shelf.chats.some((item) => writing.has(item.id));

  // Picking a character goes inside it, even when its latest chat is the page already open.
  const enter = (shelf: Shelf<ChatSummary>) => navigate(enterShelf(shelf, wide));

  const chats = current && <ShelfChats key={current.id ?? 'none'} page={page} shelf={current} />;
  if (page) return chats || (
    <CharacterTree
      typing={typing}
      onEnter={enter}
      query={query}
      onQuery={setQuery}
      openFolders={openFolders}
      onToggleFolder={(id) => setOpenFolders(openFolders.includes(id) ? openFolders.filter((open) => open !== id) : [...openFolders, id])}
    />
  );
  return (
    <>
      <SidebarRail shelves={railShelves} current={current} home={route.kind === 'home' || route.kind === 'gallery'} typing={typing} onEnter={enter} fold={chats ? { open: !collapsed, onToggle: () => onCollapse(!collapsed) } : undefined} />
      {!collapsed && chats}
    </>
  );
}
