import { FolderPlus, FolderTree as SubfolderIcon, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { FolderTree } from '../../../model/library';
import { BIN } from '../../common/words';
import { useBin, useLibrary } from '../../session';
import { IconButton, Menu, MenuItem, Row, Stack, Tab, Tabs } from '../../ui';
import { useFolderActions } from '../useFolderActions';

// 'all', 'loose' (in no folder), 'deleted' (휴지통), or a folder's id.
export type Filter = string;
// A folder being named: a new one (id null), inside parent when it has one, or one being renamed.
export type Naming = { id: string | null; name: string; parent?: FolderTree };

type Props = {
  filter: Filter;
  onFilter: (filter: Filter) => void;
  folder: FolderTree | null;
  onName: (naming: Naming) => void;
};

export function FolderTabs({ filter, onFilter, folder, onName }: Props) {
  const { characters, folders, deleted, deletedChats, byFolder } = useLibrary();
  const bin = useBin();
  const { remove } = useFolderActions();
  const top = folder && byFolder.get(folder.id)!.top;
  const binned = filter === 'deleted';
  const inBin = deleted.length + deletedChats.length + bin.modules.length + bin.prompts.length + bin.personas.length + bin.profiles.length;

  function drop(target: FolderTree) {
    const removed = remove(target);
    if (removed) onFilter(removed.up?.id ?? 'all');
  }

  return (
    <Stack gap="related">
      <Row kind="toolbar">
        <Tabs label="폴더">
          <Tab label="전체" count={characters.length} current={filter === 'all'} onClick={() => onFilter('all')} />
          {folders.map((candidate) => (
            <Tab key={candidate.id} label={candidate.value.name} count={byFolder.get(candidate.id)!.characters.length} current={candidate === top} onClick={() => onFilter(candidate.id)} />
          ))}
          {folders.length > 0 && <Tab label="폴더 없음" current={filter === 'loose'} onClick={() => onFilter('loose')} />}
          {(inBin > 0 || binned) && <Tab label={BIN} count={inBin} current={binned} onClick={() => onFilter('deleted')} />}
        </Tabs>
        {!binned && <IconButton icon={FolderPlus} label="새 폴더" size="sm" onClick={() => onName({ id: null, name: '' })} />}
        {folder && (
          <Menu place="below-end" label={`${folder.value.name} 폴더`} trigger={(opener) => <IconButton icon={MoreHorizontal} label="폴더 관리" size="sm" {...opener} />}>
            <MenuItem icon={Pencil} label="이름 바꾸기" onClick={() => onName({ id: folder.id, name: folder.value.name })} />
            {folder === top && <MenuItem icon={SubfolderIcon} label="하위 폴더 만들기" onClick={() => onName({ id: null, name: '', parent: folder })} />}
            <MenuItem icon={Trash2} label="폴더 삭제" tone="warn" onClick={() => drop(folder)} />
          </Menu>
        )}
      </Row>
      {top && top.children.length > 0 && (
        <Tabs label={`${top.value.name} 안의 폴더`}>
          <Tab label={`${top.value.name} 전체`} current={filter === top.id} onClick={() => onFilter(top.id)} />
          {top.children.map((child) => (
            <Tab key={child.id} label={child.value.name} count={byFolder.get(child.id)!.characters.length} current={filter === child.id} onClick={() => onFilter(child.id)} />
          ))}
        </Tabs>
      )}
    </Stack>
  );
}
