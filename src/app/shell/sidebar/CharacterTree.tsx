import { Import, LayoutGrid, MessageSquarePlus, PackageOpen } from 'lucide-react';
import { useMemo } from 'react';
import type { ChatSummary } from '../../../model/chat';
import { matches, type FolderTree, type Shelf } from '../../../model/library';
import { noResults } from '../../common/search';
import { ago } from '../../common/time';
import { Welcome } from '../../library/HomeScreen';
import { useImport } from '../../library/ImportFlow';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useLibrary } from '../../session';
import { Button, Empty, FolderRow, IconButton, ItemRow, Row, SearchField, Sidebar, TreeRow, Viewport } from '../../ui';
import { navigate } from '../router';
import { SidebarFooter } from './SidebarFooter';

type Props = {
  page: boolean;
  current: Shelf<ChatSummary> | undefined;
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  query: string;
  onQuery: (query: string) => void;
  openFolders: string[];
  onToggleFolder: (id: string) => void;
};

export function CharacterTree({ page, current, typing, onEnter, query, onQuery, openFolders, onToggleFolder }: Props) {
  const { characters, none, folders, byFolder, loose } = useLibrary();
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
        preview={latest ? latest.preview || latest.title : shelf.character ? NO_CHATS : '모델과 대화해요'}
        current={shelf === current}
        onClick={() => onEnter(shelf)}
      />
    );
  };
  type TreeItem = { key: string; depth: number } & ({ folder: FolderTree } | { shelf: Shelf<ChatSummary> });
  const items = useMemo(() => {
    const result: TreeItem[] = [];
    const add = (shelf: Shelf<ChatSummary>, depth: number) => result.push({ key: shelf.id ?? 'none', depth, shelf });
    const visit = (folder: FolderTree, depth: number) => {
      result.push({ key: folder.id, depth, folder });
      if (!opened.has(folder.id)) return;
      folder.children.forEach((child) => visit(child, depth + 1));
      byFolder.get(folder.id)!.direct.forEach((shelf) => add(shelf, depth + 1));
    };
    if (words) characters.filter(({ character }) => matches(character, query)).forEach((shelf) => add(shelf, 0));
    else { folders.forEach((folder) => visit(folder, 0)); loose.forEach((shelf) => add(shelf, 0)); add(none, 0); }
    return result;
  }, [words, characters, query, folders, loose, none, opened, byFolder]);

  return (
    <Sidebar
      page={page}
      actions={
        <>
          {page && <Row kind="toolbar">
            <Button variant="secondary" size="sm" icon={Import} onClick={pick}>
              봇 가져오기
            </Button>
            <IconButton icon={PackageOpen} label="Risu에서 이사" size="sm" onClick={move} />
            <IconButton icon={LayoutGrid} label="캐릭터 둘러보기" size="sm" onClick={() => navigate({ kind: 'gallery' })} />
            <IconButton icon={MessageSquarePlus} label="새 채팅" size="sm" onClick={() => navigate({ kind: 'new-chat', character: null })} />
          </Row>}
          {characters.length > 0 && <SearchField size="sm" label="캐릭터 검색" value={query} onChange={onQuery} />}
        </>
      }
      footer={page && <SidebarFooter />}
    >
      {empty && (page ? <Welcome /> : <Empty variant="side">캐릭터가 없어요.</Empty>)}
      {!empty && words && items.length === 0 && <Empty variant="side">{noResults(words)}</Empty>}
      {!empty && <Viewport keys={items.map(({ key }) => key)}>{(index) => {
        const item = items[index]!;
        return <TreeRow depth={item.depth}>{'shelf' in item ? row(item.shelf) :
          <FolderRow name={item.folder.value.name} count={byFolder.get(item.folder.id)!.characters.length}
            open={opened.has(item.folder.id)} onToggle={() => onToggleFolder(item.folder.id)} />}</TreeRow>;
      }}</Viewport>}

    </Sidebar>
  );
}
