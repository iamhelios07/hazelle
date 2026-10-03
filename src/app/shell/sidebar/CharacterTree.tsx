import { Import, LayoutGrid, PackageOpen } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import type { ChatSummary } from '../../../model/chat';
import { matches, type FolderTree, type Shelf } from '../../../model/library';
import { noResults } from '../../common/search';
import { ago } from '../../common/time';
import { Welcome } from '../../library/HomeScreen';
import { useImport } from '../../library/ImportFlow';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useLibrary } from '../../session';
import { Button, Empty, FolderRow, IconButton, ItemRow, Row, SearchField, Sidebar, useWide } from '../../ui';
import { navigate } from '../router';
import { HOME } from '../routes';
import { SidebarFooter } from './SidebarFooter';

type Props = {
  page: boolean;
  onCollapse: (() => void) | undefined;
  current: Shelf<ChatSummary> | undefined;
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  query: string;
  onQuery: (query: string) => void;
  openFolders: string[];
  onToggleFolder: (id: string) => void;
};

export function CharacterTree({ page, onCollapse, current, typing, onEnter, query, onQuery, openFolders, onToggleFolder }: Props) {
  const { characters, none, folders, byFolder, loose } = useLibrary();
  const wide = useWide();
  const { pick, move } = useImport();
  const empty = characters.length === 0 && none.chats.length === 0;
  const words = query.trim();
  const opened = useMemo(() => new Set(openFolders), [openFolders]);

  const row = (shelf: Shelf<ChatSummary>) => {
    const latest = shelf.chats[0];
    return (
      <ItemRow
        key={shelf.id ?? 'none'}
        avatar={<ShelfFace shelf={shelf} />}
        title={shelfName(shelf)}
        time={latest?.at ? ago(latest.at) : ''}
        typing={typing(shelf)}
        preview={latest ? latest.preview || latest.title : shelf.character ? NO_CHATS : '모델과 바로 이야기해요'}
        current={shelf === current}
        onClick={() => onEnter(shelf)}
      />
    );
  };
  const folderRow = (folder: FolderTree): ReactNode => {
    const open = opened.has(folder.id);
    const contents = byFolder.get(folder.id)!;
    return (
      <FolderRow key={folder.id} name={folder.value.name} count={contents.characters.length} open={open} onToggle={() => onToggleFolder(folder.id)}>
        {open && <>{folder.children.map(folderRow)}{contents.direct.map(row)}</>}
      </FolderRow>
    );
  };
  const found = words ? characters.filter(({ character }) => matches(character, query)) : [];

  return (
    <Sidebar
      page={page}
      onCollapse={onCollapse}
      actions={
        <>
          <Row kind="toolbar">
            <Button variant="secondary" size="sm" icon={Import} onClick={pick}>
              봇 가져오기
            </Button>
            <IconButton icon={PackageOpen} label="Risu에서 이사" size="sm" onClick={move} />
            <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" size="sm" onClick={() => navigate(wide ? HOME : { kind: 'gallery' })} />
          </Row>
          {characters.length > 0 && <SearchField size="sm" label="캐릭터 검색" value={query} onChange={onQuery} />}
        </>
      }
      footer={<SidebarFooter />}
    >
      {empty && (page ? <Welcome /> : <Empty variant="side">아직 캐릭터가 없어요. 봇을 가져와 보세요.</Empty>)}
      {!empty && words && found.map(row)}
      {!empty && words && found.length === 0 && <Empty variant="side">{noResults(words)}</Empty>}
      {!empty && !words && (
        <>
          {folders.map(folderRow)}
          {loose.map(row)}
          {row(none)}
        </>
      )}
    </Sidebar>
  );
}
