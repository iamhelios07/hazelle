import { ArrowDownToLine, ArrowUpToLine, FolderInput, FolderPlus, FolderTree as SubfolderIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { FOLDER_DEPTH, pathName, pathOf, withInside, type Filed, type FolderContents, type FolderIndex, type FolderTree } from '../../../model/folders';
import { Button, Divider, FolderCard, IconButton, Menu, MenuItem, MoreMenu, PathBar, Row, SelectionBar, useWide } from '../../ui';
import { ACTS, newOf } from '../acts';
import { NameDialog } from '../NameDialog';
import { withParticle } from '../particles';
import { filedCount, filedNoun, folderNote } from './filing';
import { useFolderActions } from './useFolderActions';

// What a card dragged onto a folder does; to: the folder's id, null for out of every folder.
export type Drop = (to: string | null) => (key: string) => void;

// A card's place among its own in 직접 순서: let go beside another card, or sent to either end.
export type Ordering = { onPlace: (key: string, after: boolean) => void; first: () => void; last: () => void };

export function OrderItems({ order }: { order: Ordering }) {
  return (
    <>
      <MenuItem icon={ArrowUpToLine} label="맨 앞으로" onClick={order.first} />
      <MenuItem icon={ArrowDownToLine} label="맨 뒤로" onClick={order.last} />
    </>
  );
}

// A folder being named: a new one (id null), inside parent when it has one, or one being renamed.
export type Naming = { id: string | null; name: string; parent?: FolderTree };

// The naming dialog's state and the dialog itself, which saves through the kind's folder actions.
export function useNaming(kind: Filed) {
  const { create, rename } = useFolderActions(kind);
  const [naming, setNaming] = useState<Naming | null>(null);
  const save = ({ id, name, parent }: Naming) => {
    setNaming(null);
    if (id === null) create(name, parent?.id ?? null);
    else rename(id, name);
  };
  const dialog = naming && (
    <NameDialog
      title={naming.id ? '폴더 이름 바꾸기' : naming.parent ? `'${naming.parent.value.name}' 안에 새 폴더` : '새 폴더'}
      value={naming.name}
      onSave={(name) => save({ ...naming, name })}
      onClose={() => setNaming(null)}
    />
  );
  return { name: setNaming, dialog };
}

type PathProps = {
  kind: Filed;
  path: FolderTree[];
  onGo: (place: string | null) => void;
  // Absent where folders are only walked, not made or changed, as in a picker.
  onName?: (naming: Naming) => void;
  dropInto?: Drop;
  // A place after the folders, such as 휴지통, where no folder is made.
  trail?: { key: string; name: string; onClick: () => void };
  children?: ReactNode;
};

// Where an explorer stands, from the top down, with 새 폴더 and the current folder's ⋯.
export function FolderPath({ kind, path, onGo, onName, dropInto, trail, children }: PathProps) {
  const here = path.at(-1);
  // Where nothing is made, the top alone is only the title again.
  if (!onName && !here && !trail && !children) return null;
  const parts = [
    { key: 'top', name: filedNoun(kind), onClick: () => onGo(null), onDropCard: dropInto?.(null) },
    ...path.map((folder) => ({ key: folder.id, name: folder.value.name, onClick: () => onGo(folder.id), onDropCard: dropInto?.(folder.id) })),
    ...(trail ? [trail] : []),
  ];
  return (
    <Row kind="toolbar">
      <PathBar label="폴더 경로" parts={parts} />
      {onName && !trail && path.length < FOLDER_DEPTH && (
        <IconButton icon={FolderPlus} label={here ? `'${here.value.name}' 안에 새 폴더` : '새 폴더'} size="sm" onClick={() => onName({ id: null, name: '', parent: here })} />
      )}
      {onName && !trail && here && <FolderMenu kind={kind} folder={here} depth={path.length} onName={onName} onRemoved={(up) => onGo(up)} />}
      {children}
    </Row>
  );
}

// depth: the folder's level, 1 at the top. onRemoved: where its things went (null: out of every folder).
export function FolderMenu({ kind, folder, depth, onName, onRemoved, order }: { kind: Filed; folder: FolderTree; depth: number; onName: (naming: Naming) => void; onRemoved?: (up: string | null) => void; order?: Ordering }) {
  const { remove } = useFolderActions(kind);
  return (
    <MoreMenu of={`${folder.value.name} 폴더`}>
      <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => onName({ id: folder.id, name: folder.value.name })} />
      {depth < FOLDER_DEPTH && <MenuItem icon={SubfolderIcon} label={newOf('하위 폴더')} onClick={() => onName({ id: null, name: '', parent: folder })} />}
      {order && <OrderItems order={order} />}
      <MenuItem
        icon={ACTS.remove.icon}
        label="폴더 삭제"
        tone="warn"
        onClick={() => {
          const removal = remove(folder);
          if (removal) onRemoved?.(removal.up?.id ?? null);
        }}
      />
    </MoreMenu>
  );
}

// A folder among cards. faces: up to four of what it holds. drag: the card drags beside other folders (order.onPlace);
// arranging: 순서 바꾸기 is on, so it moves by its handle.
export function FolderTile<T>({ kind, contents, depth, faces, onOpen, onName, dropInto, order, drag = false, arranging = false }: { kind: Filed; contents: FolderContents<T>; depth: number; faces: { image: string | null; name: string }[]; onOpen: () => void; onName?: (naming: Naming) => void; dropInto?: Drop; order?: Ordering; drag?: boolean; arranging?: boolean }) {
  const { folder } = contents;
  return (
    <FolderCard
      name={folder.value.name}
      note={folderNote(kind, contents)}
      faces={faces}
      onClick={onOpen}
      onDropCard={dropInto?.(folder.id)}
      drag={drag ? folder.id : undefined}
      onPlace={drag || arranging ? order?.onPlace : undefined}
      arrange={arranging && order ? { key: folder.id, label: `${folder.value.name} 폴더 순서 바꾸기` } : undefined}
      menu={onName && <FolderMenu kind={kind} folder={folder} depth={depth} onName={onName} order={order} />}
    />
  );
}

// 선택해서 옮기기's pick and, on wide screens, the drags that move cards; off moves nothing (휴지통). folderOf: where a
// thing is by its id; carry: the ids a move of one takes along, such as a prompt's copies listed under it.
export function useMoving<T>(kind: Filed, index: FolderIndex<T>, folderOf: (id: string) => string | null, { off = false, carry = (id: string) => [id] }: { off?: boolean; carry?: (id: string) => string[] } = {}) {
  const { move } = useFolderActions(kind);
  const wide = useWide();
  const [picking, setPicked] = useState<ReadonlySet<string> | null>(null);
  const picked = off ? null : picking;

  function moveIds(ids: string[], to: string | null) {
    const moving = ids.filter((id) => folderOf(id) !== to);
    const folder = to === null ? null : index.byFolder.get(to)?.folder;
    if (moving.length > 0 && folder !== undefined) move(moving.flatMap(carry), folder && { id: folder.id, name: folder.value.name }, moving.length);
  }

  // A dragged card that is one of the pick moves the whole pick.
  const dropInto: Drop | undefined = wide && !off ? (to) => (id) => {
    moveIds(picked?.has(id) ? [...picked] : [id], to);
    if (picked?.has(id)) setPicked(null);
  } : undefined;

  const toggle = (id: string) => {
    if (!picked) return;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const bar = picked && (
    <MoveBar
      kind={kind}
      index={index}
      count={picked.size}
      onCancel={() => setPicked(null)}
      onMove={(to) => {
        moveIds([...picked], to?.id ?? null);
        setPicked(null);
      }}
    />
  );
  const button = !off && (
    <Button variant="secondary" size="sm" icon={FolderInput} onClick={() => setPicked(picked ? null : new Set())}>
      {picked ? '완료' : '선택해서 옮기기'}
    </Button>
  );
  return { picked, toggle, dropInto, bar, button };
}

type MoveProps<T> = {
  kind: Filed;
  index: FolderIndex<T>;
  count: number;
  onCancel: () => void;
  onMove: (to: FolderTree | null) => void;
};

function MoveBar<T>({ kind, index, count, onCancel, onMove }: MoveProps<T>) {
  return (
    <SelectionBar>
      <span>{count ? `${filedCount(kind, count)} 선택됨` : `옮길 ${withParticle(filedNoun(kind), '을/를')} 선택해 주세요`}</span>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        취소
      </Button>
      <Menu
        place="above-end"
        label="옮길 폴더"
        trigger={(opener) => (
          <Button size="sm" disabled={count === 0 || index.folders.length === 0} {...opener}>
            폴더로 옮기기
          </Button>
        )}
      >
        {index.folders.flatMap(withInside).map((folder) => (
          <MenuItem key={folder.id} label={pathName(pathOf(index.byFolder, folder.id))} onClick={() => onMove(folder)} />
        ))}
        <Divider variant="menu" />
        <MenuItem label="폴더에서 빼기" onClick={() => onMove(null)} />
      </Menu>
    </SelectionBar>
  );
}
