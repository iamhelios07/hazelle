import { FolderInput, FolderPlus, FolderTree as SubfolderIcon, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ApiFailure } from '../../runtime/api';
import { holds, shownFolders, type Character, type Folder, type FolderTree } from '../../runtime/library';
import { navigate } from '../router';
import { useLibrary, useStore } from '../store';
import { useToast } from '../toast';
import {
  Button,
  CardGrid,
  FaceCard,
  IconButton,
  MenuDivider,
  MenuItem,
  NavBar,
  Popover,
  Row,
  Screen,
  SearchField,
  SelectionBar,
  Stack,
  Tab,
  Tabs,
  Text,
  useWide,
} from '../ui';
import { describeFailure } from './failure';
import { NameDialog } from './NameDialog';
import { shelfTarget } from './shelves';
import { ago } from './time';

// 'all', 'loose' (in no folder), or a folder's id.
type Filter = string;
type Naming = { id: string | null; name: string; parent?: FolderTree };
type Placement = { id: string; folder: string | null };

// 캐릭터 둘러보기 (design F6): every character as a face, filtered by folder, and where folders are
// made, renamed, emptied and filled.
export function GalleryScreen() {
  const { characters, folders } = useLibrary();
  const store = useStore();
  const toast = useToast();
  const wide = useWide();
  const [filter, setFilter] = useState<Filter>('all');
  const [byName, setByName] = useState(false);
  const [query, setQuery] = useState('');
  // The characters picked to move, or null while not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [menu, setMenu] = useState<'move' | 'folder' | null>(null);

  const everyFolder = folders.flatMap((top) => [top, ...top.children]);
  const filed = shownFolders(folders);
  const folder = everyFolder.find((candidate) => candidate.id === filter) ?? null;
  // The top folder whose subfolders show as a second row of tabs: the one picked, or the one holding it.
  const top = folder && (folders.find((candidate) => candidate === folder || candidate.children.includes(folder)) ?? null);
  const words = query.trim().toLowerCase();
  const shown = characters
    .filter(({ character }) => filter === 'all' || (filter === 'loose' ? character.folder === null || !filed.has(character.folder) : folder !== null && holds(folder, character)))
    .filter(({ character }) => `${character.card.name} ${character.card.nickname ?? ''}`.toLowerCase().includes(words));
  if (byName) shown.sort((a, b) => a.character.card.name.localeCompare(b.character.card.name, 'ko'));

  const saveFailed = (failure: ApiFailure) => {
    toast({ message: describeFailure(failure) });
  };

  // Whether every character moved; a failure is shown and stops the rest.
  async function place(moves: Placement[]): Promise<boolean> {
    for (const { id, folder: to } of moves) {
      const saved = await store.save<Character>('character', id, (current) => ({ ...current!, folder: to }));
      if (!saved.ok) {
        saveFailed(saved);
        return false;
      }
    }
    return true;
  }

  async function saveFolder({ id, name, parent }: Naming) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNaming(null);
    const saved = await store.save<Folder>('folder', id ?? crypto.randomUUID(), (current) =>
      current ? { ...current, name: trimmed } : parent ? { name: trimmed, parent: parent.id } : { name: trimmed },
    );
    if (!saved.ok) saveFailed(saved);
  }

  // A folder goes with the folders inside it, and its characters first move up a level, so no
  // character points at a folder that is gone. 되돌리기 puts the folders back under their ids and every
  // character back where it was.
  async function removeFolder(target: FolderTree) {
    setMenu(null);
    const up = folders.find((candidate) => candidate.children.includes(target)) ?? null;
    const members = characters.filter(({ character }) => holds(target, character)).map(({ id, character }) => ({ id, folder: character.folder }));
    if (!(await place(members.map(({ id }) => ({ id, folder: up?.id ?? null }))))) return;
    for (const gone of [...target.children, target]) {
      const removed = await store.remove(gone.id);
      if (!removed.ok) return saveFailed(removed);
    }
    setFilter(up?.id ?? 'all');
    const inside = target.children.length ? `와 안의 폴더 ${target.children.length}개` : '';
    toast({
      message: `‘${target.value.name}’ 폴더${inside}를 지웠어요. 캐릭터는 ${up ? `‘${up.value.name}’ 폴더로` : '폴더 밖으로'} 옮겼어요.`,
      action: { label: '되돌리기', onClick: () => void restore([target, ...target.children], members) },
    });
  }

  async function restore(gone: FolderTree[], members: Placement[]) {
    for (const { id, value } of gone) {
      const saved = await store.save<Folder>('folder', id, () => value);
      if (!saved.ok) return saveFailed(saved);
    }
    await place(members);
  }

  async function movePicked(to: string | null) {
    if (!picked) return;
    setMenu(null);
    if (!(await place([...picked].map((id) => ({ id, folder: to }))))) return;
    const name = everyFolder.find((candidate) => candidate.id === to)?.value.name;
    toast({ message: to ? `${picked.size}명을 ‘${name}’ 폴더로 옮겼어요.` : `${picked.size}명을 폴더에서 뺐어요.` });
    setPicked(null);
  }

  const toggle = (id: string) => {
    if (!picked) return;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <Screen width="wide" top={wide ? undefined : <NavBar title="캐릭터" onBack={() => navigate('/')} backLabel="목록으로" />}>
      <Stack gap={24}>
        <Row>
          <SearchField size="sm" label="캐릭터 검색" value={query} onChange={setQuery} />
          <Button variant="secondary" size="sm" onClick={() => setByName(!byName)}>
            {byName ? '이름 순' : '최근 대화 순'}
          </Button>
          <Button variant="secondary" size="sm" icon={FolderInput} onClick={() => setPicked(picked ? null : new Set())}>
            {picked ? '고르기 끝' : '골라서 옮기기'}
          </Button>
        </Row>
        <Stack gap={12}>
          <Row>
            <Tabs label="폴더">
              <Tab label="전체" count={characters.length} current={filter === 'all'} onClick={() => setFilter('all')} />
              {folders.map((candidate) => (
                <Tab
                  key={candidate.id}
                  label={candidate.value.name}
                  count={characters.filter(({ character }) => holds(candidate, character)).length}
                  current={candidate === top}
                  onClick={() => setFilter(candidate.id)}
                />
              ))}
              {folders.length > 0 && <Tab label="폴더 없음" current={filter === 'loose'} onClick={() => setFilter('loose')} />}
            </Tabs>
            <IconButton icon={FolderPlus} label="새 폴더" size="sm" onClick={() => setNaming({ id: null, name: '' })} />
            {folder && (
              <Popover
                open={menu === 'folder'}
                onClose={() => setMenu(null)}
                place="below-end"
                label={`${folder.value.name} 폴더`}
                trigger={<IconButton icon={MoreHorizontal} label="폴더 관리" size="sm" expanded={menu === 'folder'} onClick={() => setMenu(menu === 'folder' ? null : 'folder')} />}
              >
                <MenuItem
                  icon={Pencil}
                  label="이름 바꾸기"
                  onClick={() => {
                    setMenu(null);
                    setNaming({ id: folder.id, name: folder.value.name });
                  }}
                />
                {folder === top && (
                  <MenuItem
                    icon={SubfolderIcon}
                    label="안에 폴더 만들기"
                    onClick={() => {
                      setMenu(null);
                      setNaming({ id: null, name: '', parent: folder });
                    }}
                  />
                )}
                <MenuItem icon={Trash2} label="폴더 지우기" tone="warn" onClick={() => void removeFolder(folder)} />
              </Popover>
            )}
          </Row>
          {top && top.children.length > 0 && (
            <Tabs label={`${top.value.name} 안의 폴더`}>
              <Tab label={`${top.value.name} 전체`} current={filter === top.id} onClick={() => setFilter(top.id)} />
              {top.children.map((child) => (
                <Tab
                  key={child.id}
                  label={child.value.name}
                  count={characters.filter(({ character }) => holds(child, character)).length}
                  current={filter === child.id}
                  onClick={() => setFilter(child.id)}
                />
              ))}
            </Tabs>
          )}
        </Stack>
        {shown.length > 0 ? (
          <CardGrid label="캐릭터">
            {shown.map((shelf) => {
              const latest = shelf.chats[0];
              return (
                <FaceCard
                  key={shelf.id}
                  image={shelf.face}
                  name={shelf.character.card.name}
                  note={latest?.at ? `${ago(latest.at)} · 채팅 ${shelf.chats.length}개` : '아직 채팅이 없어요'}
                  selected={picked ? picked.has(shelf.id) : null}
                  onClick={() => (picked ? toggle(shelf.id) : navigate(shelfTarget(shelf, wide)))}
                />
              );
            })}
          </CardGrid>
        ) : (
          <Text tone="muted">{words ? `“${query.trim()}” 검색 결과가 없어요.` : '이 폴더는 비어 있어요. ‘골라서 옮기기’로 캐릭터를 넣어 보세요.'}</Text>
        )}
      </Stack>
      {picked && (
        <SelectionBar>
          <span>{picked.size ? `${picked.size}명 골랐어요` : '옮길 캐릭터를 눌러 고르세요'}</span>
          <Button variant="secondary" size="sm" onClick={() => setPicked(null)}>
            취소
          </Button>
          <Popover
            open={menu === 'move'}
            onClose={() => setMenu(null)}
            place="above-end"
            label="옮길 폴더"
            trigger={
              <Button size="sm" disabled={picked.size === 0 || folders.length === 0} onClick={() => setMenu(menu === 'move' ? null : 'move')}>
                폴더로 옮기기
              </Button>
            }
          >
            {folders.flatMap((candidate) => [
              <MenuItem key={candidate.id} label={candidate.value.name} onClick={() => void movePicked(candidate.id)} />,
              ...candidate.children.map((child) => (
                <MenuItem key={child.id} label={`${candidate.value.name} › ${child.value.name}`} onClick={() => void movePicked(child.id)} />
              )),
            ])}
            <MenuDivider />
            <MenuItem label="폴더에서 빼기" onClick={() => void movePicked(null)} />
          </Popover>
        </SelectionBar>
      )}
      {naming && (
        <NameDialog title={naming.id ? '폴더 이름 바꾸기' : naming.parent ? `‘${naming.parent.value.name}’ 안에 새 폴더` : '새 폴더'} value={naming.name} onSave={(name) => void saveFolder({ ...naming, name })} onClose={() => setNaming(null)} />
      )}
    </Screen>
  );
}
