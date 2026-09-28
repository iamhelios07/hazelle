import { FolderPlus, FolderTree as SubfolderIcon, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { holds, type FolderTree } from '../../../model/library';
import { useLibrary } from '../../session';
import { IconButton, MenuItem, Popover, Row, Stack, Tab, Tabs } from '../../ui';
import { useFolderActions } from '../useFolderActions';

// 'all', 'loose' (in no folder), 'deleted' (지운 캐릭터), or a folder's id.
export type Filter = string;
// A folder being named: a new one (id null), inside parent when it has one, or one being renamed.
export type Naming = { id: string | null; name: string; parent?: FolderTree };

type Props = {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  // The folder the filter picks, if it picks one.
  folder: FolderTree | null;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onName: (naming: Naming) => void;
};

export function FolderTabs({ filter, onFilter, folder, menuOpen, onMenu, onName }: Props) {
  const { characters, folders, deleted } = useLibrary();
  const { remove } = useFolderActions();
  // The top folder whose subfolders show as a second row of tabs: the one picked, or the one holding it.
  const top = folder && (folders.find((candidate) => candidate === folder || candidate.children.includes(folder)) ?? null);
  const binned = filter === 'deleted';
  const count = (candidate: FolderTree) => characters.filter(({ character }) => holds(candidate, character)).length;

  async function drop(target: FolderTree) {
    onMenu(false);
    const removed = await remove(target);
    if (removed) onFilter(removed.up?.id ?? 'all');
  }

  const name = (naming: Naming) => {
    onMenu(false);
    onName(naming);
  };

  return (
    <Stack gap="related">
      <Row kind="toolbar">
        <Tabs label="폴더">
          <Tab label="전체" count={characters.length} current={filter === 'all'} onClick={() => onFilter('all')} />
          {folders.map((candidate) => (
            <Tab key={candidate.id} label={candidate.value.name} count={count(candidate)} current={candidate === top} onClick={() => onFilter(candidate.id)} />
          ))}
          {folders.length > 0 && <Tab label="폴더 없음" current={filter === 'loose'} onClick={() => onFilter('loose')} />}
          {(deleted.length > 0 || binned) && <Tab label="지운 캐릭터" count={deleted.length} current={binned} onClick={() => onFilter('deleted')} />}
        </Tabs>
        {!binned && <IconButton icon={FolderPlus} label="새 폴더" size="sm" onClick={() => onName({ id: null, name: '' })} />}
        {folder && (
          <Popover
            open={menuOpen}
            onClose={() => onMenu(false)}
            place="below-end"
            label={`${folder.value.name} 폴더`}
            trigger={<IconButton icon={MoreHorizontal} label="폴더 관리" size="sm" expanded={menuOpen} onClick={() => onMenu(!menuOpen)} />}
          >
            <MenuItem icon={Pencil} label="이름 바꾸기" onClick={() => name({ id: folder.id, name: folder.value.name })} />
            {folder === top && <MenuItem icon={SubfolderIcon} label="안에 폴더 만들기" onClick={() => name({ id: null, name: '', parent: folder })} />}
            <MenuItem icon={Trash2} label="폴더 지우기" tone="warn" onClick={() => void drop(folder)} />
          </Popover>
        )}
      </Row>
      {top && top.children.length > 0 && (
        <Tabs label={`${top.value.name} 안의 폴더`}>
          <Tab label={`${top.value.name} 전체`} current={filter === top.id} onClick={() => onFilter(top.id)} />
          {top.children.map((child) => (
            <Tab key={child.id} label={child.value.name} count={count(child)} current={filter === child.id} onClick={() => onFilter(child.id)} />
          ))}
        </Tabs>
      )}
    </Stack>
  );
}
