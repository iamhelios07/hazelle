import { FolderPlus, FolderTree as SubfolderIcon } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import { FOLDER_DEPTH, pathOf, type FolderContents, type FolderTree } from '../../../model/library';
import { ACTS, newOf } from '../../common/acts';
import { aliased } from '../../common/alias';
import { BIN } from '../../common/words';
import { useLibrary } from '../../session';
import { navigate } from '../../shell/router';
import { BIN_PLACE } from '../../shell/routes';
import { Button, FolderCard, IconButton, MenuItem, MoreMenu, PathBar, Row } from '../../ui';
import { useFolderActions } from '../useFolderActions';
import type { Naming } from './FolderTabs';
import { useInBin } from './useInBin';

const TOP = '캐릭터';
const go = (place: string | null) => navigate({ kind: 'gallery', place });

type PathProps = {
  // null at the top.
  here: FolderContents<ChatSummary> | null;
  binned: boolean;
  onName: (naming: Naming) => void;
};

// 실험실 탐색기식 폴더: where 캐릭터 둘러보기 stands, in place of the folder tabs.
export function FolderPath({ here, binned, onName }: PathProps) {
  const { byFolder } = useLibrary();
  const inBin = useInBin();
  const path = here ? pathOf(byFolder, here.folder.id) : [];
  const parts = [
    { key: 'top', name: TOP, onClick: () => go(null) },
    ...path.map((folder) => ({ key: folder.id, name: folder.value.name, onClick: () => go(folder.id) })),
    ...(binned ? [{ key: BIN_PLACE, name: BIN, onClick: () => go(BIN_PLACE) }] : []),
  ];
  return (
    <Row kind="toolbar">
      <PathBar label="폴더 경로" parts={parts} />
      {!binned && path.length < FOLDER_DEPTH && (
        <IconButton icon={FolderPlus} label={here ? `'${here.folder.value.name}' 안에 새 폴더` : '새 폴더'} size="sm" onClick={() => onName({ id: null, name: '', parent: here?.folder })} />
      )}
      {!binned && inBin > 0 && (
        <Button variant="ghost" size="sm" onClick={() => go(BIN_PLACE)}>
          {`${BIN} ${inBin}`}
        </Button>
      )}
    </Row>
  );
}

// A folder's card in 캐릭터 둘러보기, which opens it.
export function FolderTile({ folder, onName }: { folder: FolderTree; onName: (naming: Naming) => void }) {
  const { byFolder } = useLibrary();
  const { remove } = useFolderActions();
  const { characters } = byFolder.get(folder.id)!;
  const deep = pathOf(byFolder, folder.id).length;
  const inner = folder.children.length;
  const note = [inner > 0 && `폴더 ${inner}개`, `${characters.length}명`].filter(Boolean).join(' · ');
  return (
    <FolderCard
      name={folder.value.name}
      note={note}
      faces={characters.slice(0, 4).map(({ face, character }) => ({ image: face, name: aliased(character.card.name, character.alias) }))}
      onClick={() => go(folder.id)}
      menu={
        <MoreMenu of={`${folder.value.name} 폴더`}>
          <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => onName({ id: folder.id, name: folder.value.name })} />
          {deep < FOLDER_DEPTH && <MenuItem icon={SubfolderIcon} label={newOf('하위 폴더')} onClick={() => onName({ id: null, name: '', parent: folder })} />}
          <MenuItem icon={ACTS.remove.icon} label="폴더 삭제" tone="warn" onClick={() => remove(folder)} />
        </MoreMenu>
      }
    />
  );
}
