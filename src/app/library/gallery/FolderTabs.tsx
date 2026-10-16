import { FolderPlus } from 'lucide-react';
import { pathOf, type FolderTree } from '../../../model/library';
import { BIN } from '../../common/words';
import { useLibrary } from '../../session';
import { IconButton, Row, Stack, Tab, Tabs } from '../../ui';
import { useFolderActions } from '../useFolderActions';
import { FolderMenu } from './FolderPlace';
import { useInBin } from './useInBin';

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
  const { characters, folders, byFolder } = useLibrary();
  const inBin = useInBin();
  const { remove } = useFolderActions();
  const path = folder ? pathOf(byFolder, folder.id) : [];
  const top = path[0] ?? null;
  const binned = filter === 'deleted';

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
          <FolderMenu folder={folder} onName={onName} onRemove={() => drop(folder)} />
        )}
      </Row>
      {path.map((above, level) => above.children.length > 0 && (
        <Tabs key={above.id} label={`${above.value.name} 안의 폴더`}>
          <Tab label={`${above.value.name} 전체`} current={filter === above.id} onClick={() => onFilter(above.id)} />
          {above.children.map((child) => (
            <Tab key={child.id} label={child.value.name} count={byFolder.get(child.id)!.characters.length} current={child === path[level + 1]} onClick={() => onFilter(child.id)} />
          ))}
        </Tabs>
      ))}
    </Stack>
  );
}
