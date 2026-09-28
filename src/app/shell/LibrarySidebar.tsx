import { ChevronLeft, Import, LayoutGrid, Lock, LogOut, Plug, Plus, Settings } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ChatItem } from '../../model/chat';
import { holds, matches, shownFolders, type FolderTree, type Shelf } from '../../model/library';
import { ago } from '../common/time';
import { Welcome } from '../library/HomeScreen';
import { useImport } from '../library/ImportFlow';
import { ShelfFace, shelfName } from '../library/shelf';
import { useAccount, useLibrary, useSession, useTurn, useViews } from '../session';
import { useToast } from '../toast';
import {
  AccountRow,
  Avatar,
  Button,
  FaceButton,
  FaceStrip,
  FolderRow,
  IconButton,
  ItemRow,
  MenuItem,
  NavRow,
  Popover,
  Rail,
  Row,
  SearchField,
  SideNote,
  SideTitle,
  Sidebar,
  useWide,
} from '../ui';
import { navigate, useRoute } from './router';
import { characterPage, connectionList, enterShelf, HOME, href, shelfOf, type Route } from './routes';

// The recent-characters strip fits five faces beside each other in the sidebar's width.
const STRIP = 5;
const OPEN_FOLDERS = 'risu-alpha:open-folders';

// A per-device convenience, like the collapsed sidebar: without storage every folder starts closed.
function rememberedFolders(): string[] {
  try {
    const open: unknown = JSON.parse(localStorage.getItem(OPEN_FOLDERS) ?? '[]');
    return Array.isArray(open) ? open.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

type Props = {
  // Phones: the list is the home screen.
  page: boolean;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
};

// Characters first (design F6). Inside a character, the list is its chats, and "모든 캐릭터" goes back
// up without leaving the open chat.
export function LibrarySidebar({ page, collapsed, onCollapse }: Props) {
  const { characters, none, folders } = useLibrary();
  const { chatById } = useViews();
  const { onLock, onLogout } = useAccount();
  const { username } = useSession();
  const turn = useTurn();
  const route = useRoute();
  const at = href(route);
  const wide = useWide();
  const toast = useToast();
  const { pick } = useImport();
  const [query, setQuery] = useState('');
  const [account, setAccount] = useState(false);
  // The path at which the user went up to every character. Moving to another page comes back down.
  const [upAt, setUpAt] = useState<string | null>(null);
  if (upAt !== null && upAt !== at) setUpAt(null);
  const [openFolders, setOpenFolders] = useState(rememberedFolders);

  const shelves = [...characters, none];
  const here = shelfOf(route, chatById);
  const current = here === undefined ? undefined : shelves.find((shelf) => shelf.id === here);
  const openChat = route.kind === 'chat' ? route.id : undefined;
  const typing = (shelf: Shelf<ChatItem>) => shelf.chats.some((item) => item.id === turn?.chat);
  const empty = characters.length === 0 && none.chats.length === 0;

  // Picking a character goes inside it, even when its latest chat is the page already open.
  const enter = (shelf: Shelf<ChatItem>) => {
    setUpAt(null);
    navigate(enterShelf(shelf, wide));
  };

  const toggleFolder = (id: string) => {
    const next = openFolders.includes(id) ? openFolders.filter((open) => open !== id) : [...openFolders, id];
    setOpenFolders(next);
    try {
      localStorage.setItem(OPEN_FOLDERS, JSON.stringify(next));
    } catch {
      // Remembering is a convenience only.
    }
  };

  const accountMenu = (
    <Popover
      open={account}
      onClose={() => setAccount(false)}
      place={collapsed && !page ? 'beside' : 'above-start'}
      label="계정"
      trigger={<IconButton icon={Settings} label="계정" size="sm" expanded={account} onClick={() => setAccount(!account)} />}
    >
      <MenuItem icon={Lock} label="잠그기" onClick={onLock} />
      <MenuItem
        icon={LogOut}
        label="로그아웃"
        onClick={() => {
          setAccount(false);
          void onLogout().then((failure) => failure && toast({ message: failure }));
        }}
      />
    </Popover>
  );

  if (collapsed && !page) {
    return (
      <Rail
        onExpand={() => onCollapse(false)}
        actions={
          <>
            <IconButton icon={Import} label="봇 가져오기" onClick={pick} />
            <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" onClick={() => navigate(HOME)} />
          </>
        }
        footer={
          <>
            <IconButton icon={Plug} label="연결" onClick={() => navigate({ kind: 'connections' })} />
            {accountMenu}
          </>
        }
      >
        {shelves.map((shelf) => (
          <FaceButton key={shelf.id ?? 'none'} label={shelfName(shelf)} current={shelf === current} dot={typing(shelf) ? 'accent' : undefined} onClick={() => enter(shelf)}>
            <ShelfFace shelf={shelf} />
          </FaceButton>
        ))}
      </Rail>
    );
  }

  const footer = (
    <>
      <NavRow icon={Plug} label="연결" current={connectionList(route) !== null} onClick={() => navigate({ kind: 'connections' })} />
      <AccountRow avatar={<Avatar face={username} size="sm" tone="you" />} name={username}>
        {accountMenu}
      </AccountRow>
    </>
  );

  if (current && upAt !== at) {
    const others = characters.filter((shelf) => shelf !== current && shelf.chats.length > 0).slice(0, STRIP);
    // 캐릭터 없이 has a page only beside its chats.
    const about: Route | null = current.id !== null ? characterPage(current.id, !page) : page ? null : { kind: 'shelf', character: null };
    return (
      <Sidebar
        page={page}
        onCollapse={page ? undefined : () => onCollapse(true)}
        actions={
          <>
            <NavRow icon={ChevronLeft} label="모든 캐릭터" onClick={() => (page ? navigate(HOME) : setUpAt(at))} />
            {others.length > 0 && (
              <FaceStrip label="최근 캐릭터">
                {others.map((shelf) => (
                  <FaceButton key={shelf.id} label={shelfName(shelf)} dot={typing(shelf) ? 'accent' : undefined} onClick={() => enter(shelf)}>
                    <ShelfFace shelf={shelf} />
                  </FaceButton>
                ))}
              </FaceStrip>
            )}
            <SideTitle avatar={<ShelfFace shelf={current} />} name={shelfName(current)} onOpen={about === null ? undefined : () => navigate(about)}>
              <IconButton icon={Plus} label="새 채팅" size="sm" onClick={() => navigate({ kind: 'new-chat', character: current.id })} />
            </SideTitle>
          </>
        }
        footer={footer}
      >
        {current.chats.map((item) => (
          <ItemRow
            key={item.id}
            title={item.title}
            time={item.at === null ? '' : ago(item.at)}
            typing={turn?.chat === item.id}
            preview={item.preview}
            current={item.id === openChat}
            onClick={() => navigate({ kind: 'chat', id: item.id })}
          />
        ))}
        {current.chats.length === 0 && <SideNote>아직 채팅이 없어요.</SideNote>}
      </Sidebar>
    );
  }

  const words = query.trim();
  const filed = shownFolders(folders);
  const row = (shelf: Shelf<ChatItem>) => {
    const latest = shelf.chats[0];
    return (
      <ItemRow
        key={shelf.id ?? 'none'}
        avatar={<ShelfFace shelf={shelf} />}
        title={shelfName(shelf)}
        time={latest?.at ? ago(latest.at) : ''}
        typing={typing(shelf)}
        preview={latest?.title ?? (shelf.character ? '아직 채팅이 없어요' : '모델과 바로 이야기해요')}
        current={shelf === current}
        onClick={() => enter(shelf)}
      />
    );
  };
  const folderRow = (folder: FolderTree): ReactNode => (
    <FolderRow
      key={folder.id}
      name={folder.value.name}
      count={characters.filter(({ character }) => holds(folder, character)).length}
      open={openFolders.includes(folder.id)}
      onToggle={() => toggleFolder(folder.id)}
    >
      {folder.children.map(folderRow)}
      {characters.filter(({ character }) => character.folder === folder.id).map(row)}
    </FolderRow>
  );
  const found = characters.filter(({ character }) => matches(character, query));

  return (
    <Sidebar
      page={page}
      onCollapse={page ? undefined : () => onCollapse(true)}
      actions={
        <>
          <Row>
            <Button variant="secondary" size="sm" icon={Import} onClick={pick}>
              봇 가져오기
            </Button>
            <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" size="sm" onClick={() => navigate(wide ? HOME : { kind: 'gallery' })} />
          </Row>
          {characters.length > 0 && <SearchField size="sm" label="캐릭터 검색" value={query} onChange={setQuery} />}
        </>
      }
      footer={footer}
    >
      {empty && (page ? <Welcome /> : <SideNote>아직 캐릭터가 없어요. 봇을 가져와 보세요.</SideNote>)}
      {!empty && words && found.map(row)}
      {!empty && words && found.length === 0 && <SideNote>“{words}” 검색 결과가 없어요.</SideNote>}
      {!empty && !words && (
        <>
          {folders.map(folderRow)}
          {characters.filter(({ character }) => !character.folder || !filed.has(character.folder)).map(row)}
          {row(none)}
        </>
      )}
    </Sidebar>
  );
}
