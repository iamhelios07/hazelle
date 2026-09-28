import { FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ApiFailure } from '../../runtime/api';
import type { Character, Folder } from '../../runtime/library';
import type { Stored } from '../../runtime/store';
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
type Naming = { id: string | null; name: string };

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

  const filed = new Set(folders.map((folder) => folder.id));
  const inFolder = (folder: string | null) => (folder && filed.has(folder) ? folder : null);
  const folder = folders.find((candidate) => candidate.id === filter) ?? null;
  const words = query.trim().toLowerCase();
  const shown = characters
    .filter(({ character }) => filter === 'all' || (filter === 'loose' ? inFolder(character.folder) === null : character.folder === filter))
    .filter(({ character }) => `${character.card.name} ${character.card.nickname ?? ''}`.toLowerCase().includes(words));
  if (byName) shown.sort((a, b) => a.character.card.name.localeCompare(b.character.card.name, 'ko'));

  const saveFailed = (failure: ApiFailure) => {
    toast({ message: describeFailure(failure) });
  };

  // Whether every character moved; a failure is shown and stops the rest.
  async function move(ids: string[], to: string | null): Promise<boolean> {
    for (const id of ids) {
      const saved = await store.save<Character>('character', id, (current) => ({ ...current!, folder: to }));
      if (!saved.ok) {
        saveFailed(saved);
        return false;
      }
    }
    return true;
  }

  async function saveFolder({ id, name }: Naming) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNaming(null);
    const saved = await store.save<Folder>('folder', id ?? crypto.randomUUID(), () => ({ name: trimmed }));
    if (!saved.ok) saveFailed(saved);
  }

  // Its characters leave it first, so no character points at a folder that is gone. 되돌리기 puts
  // the folder back under its id and its characters back in it.
  async function removeFolder(target: Stored<Folder>) {
    setMenu(null);
    const members = characters.filter(({ character }) => character.folder === target.id).map(({ id }) => id);
    if (!(await move(members, null))) return;
    const removed = await store.remove(target.id);
    if (!removed.ok) return saveFailed(removed);
    setFilter('all');
    toast({
      message: `‘${target.value.name}’ 폴더를 지웠어요. 캐릭터는 그대로 있어요.`,
      action: {
        label: '되돌리기',
        onClick: () =>
          void store.save<Folder>('folder', target.id, () => target.value).then((saved) => (saved.ok ? void move(members, target.id) : saveFailed(saved))),
      },
    });
  }

  async function movePicked(to: string | null) {
    if (!picked) return;
    setMenu(null);
    if (!(await move([...picked], to))) return;
    const name = folders.find((candidate) => candidate.id === to)?.value.name;
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
        <Row>
          <Tabs label="폴더">
            <Tab label="전체" count={characters.length} current={filter === 'all'} onClick={() => setFilter('all')} />
            {folders.map((candidate) => (
              <Tab
                key={candidate.id}
                label={candidate.value.name}
                count={characters.filter(({ character }) => character.folder === candidate.id).length}
                current={filter === candidate.id}
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
              <MenuItem icon={Trash2} label="폴더 지우기" tone="warn" onClick={() => void removeFolder(folder)} />
            </Popover>
          )}
        </Row>
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
            {folders.map((candidate) => (
              <MenuItem key={candidate.id} label={candidate.value.name} onClick={() => void movePicked(candidate.id)} />
            ))}
            <MenuDivider />
            <MenuItem label="폴더에서 빼기" onClick={() => void movePicked(null)} />
          </Popover>
        </SelectionBar>
      )}
      {naming && (
        <NameDialog title={naming.id ? '폴더 이름 바꾸기' : '새 폴더'} value={naming.name} onSave={(name) => void saveFolder({ ...naming, name })} onClose={() => setNaming(null)} />
      )}
    </Screen>
  );
}
