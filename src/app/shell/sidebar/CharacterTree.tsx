import { Import, LayoutGrid } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ChatItem } from '../../../model/chat';
import { holds, matches, shownFolders, type FolderTree, type Shelf } from '../../../model/library';
import { noResults } from '../../common/search';
import { ago } from '../../common/time';
import { Welcome } from '../../library/HomeScreen';
import { useImport } from '../../library/ImportFlow';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useLibrary } from '../../session';
import { Button, FolderRow, IconButton, ItemRow, Row, SearchField, SideNote, Sidebar, useWide } from '../../ui';
import { navigate } from '../router';
import { HOME } from '../routes';
import { SidebarFooter } from './SidebarFooter';

type Props = {
  page: boolean;
  onCollapse: (() => void) | undefined;
  current: Shelf<ChatItem> | undefined;
  typing: (shelf: Shelf<ChatItem>) => boolean;
  onEnter: (shelf: Shelf<ChatItem>) => void;
  query: string;
  onQuery: (query: string) => void;
  openFolders: string[];
  onToggleFolder: (id: string) => void;
};

export function CharacterTree({ page, onCollapse, current, typing, onEnter, query, onQuery, openFolders, onToggleFolder }: Props) {
  const { characters, none, folders } = useLibrary();
  const wide = useWide();
  const { pick } = useImport();
  const empty = characters.length === 0 && none.chats.length === 0;
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
        preview={latest?.title ?? (shelf.character ? NO_CHATS : '모델과 바로 이야기해요')}
        current={shelf === current}
        onClick={() => onEnter(shelf)}
      />
    );
  };
  const folderRow = (folder: FolderTree): ReactNode => (
    <FolderRow
      key={folder.id}
      name={folder.value.name}
      count={characters.filter(({ character }) => holds(folder, character)).length}
      open={openFolders.includes(folder.id)}
      onToggle={() => onToggleFolder(folder.id)}
    >
      {folder.children.map(folderRow)}
      {characters.filter(({ character }) => character.folder === folder.id).map(row)}
    </FolderRow>
  );
  const found = characters.filter(({ character }) => matches(character, query));

  return (
    <Sidebar
      page={page}
      onCollapse={onCollapse}
      actions={
        <>
          <Row>
            <Button variant="secondary" size="sm" icon={Import} onClick={pick}>
              봇 가져오기
            </Button>
            <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" size="sm" onClick={() => navigate(wide ? HOME : { kind: 'gallery' })} />
          </Row>
          {characters.length > 0 && <SearchField size="sm" label="캐릭터 검색" value={query} onChange={onQuery} />}
        </>
      }
      footer={<SidebarFooter />}
    >
      {empty && (page ? <Welcome /> : <SideNote>아직 캐릭터가 없어요. 봇을 가져와 보세요.</SideNote>)}
      {!empty && words && found.map(row)}
      {!empty && words && found.length === 0 && <SideNote>{noResults(words)}</SideNote>}
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
