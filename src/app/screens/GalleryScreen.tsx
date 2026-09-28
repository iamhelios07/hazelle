import { Copy, FolderInput, FolderPlus, FolderTree as SubfolderIcon, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ApiFailure } from '../../runtime/api';
import { holds, KEEP_DELETED, shownFolders, type CharacterShelf, type FolderTree } from '../../model/library';
import { navigate } from '../router';
import { useLibrary, useStore, type ChatItem } from '../store';
import { useToast } from '../toast';
import {
  Button,
  CardGrid,
  Dialog,
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
import { useCharacterActions } from './characterActions';
import { describeFailure } from './failure';
import { NameDialog } from './NameDialog';
import { shelfTarget } from './shelves';
import { ago } from './time';

// 'all', 'loose' (in no folder), 'deleted' (지운 캐릭터), or a folder's id.
type Filter = string;
type Menu = 'move' | 'folder' | `card-${string}`;
const DAY = 24 * 60 * 60 * 1000;
type Naming = { id: string | null; name: string; parent?: FolderTree };
type Placement = { id: string; folder: string | null };

// 캐릭터 둘러보기 (design F6): every character as a face, filtered by folder, and where folders are
// made, renamed, emptied and filled.
export function GalleryScreen() {
  const { characters, folders, deleted } = useLibrary();
  const { busy, copy, remove, restore, purge } = useCharacterActions();
  const store = useStore();
  const toast = useToast();
  const wide = useWide();
  const [filter, setFilter] = useState<Filter>('all');
  const [byName, setByName] = useState(false);
  const [query, setQuery] = useState('');
  // The characters picked to move, or null while not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  // The character 지금 지우기 asks about before it goes for good.
  const [purging, setPurging] = useState<CharacterShelf<ChatItem> | null>(null);

  const everyFolder = folders.flatMap((top) => [top, ...top.children]);
  const filed = shownFolders(folders);
  const folder = everyFolder.find((candidate) => candidate.id === filter) ?? null;
  // The top folder whose subfolders show as a second row of tabs: the one picked, or the one holding it.
  const top = folder && (folders.find((candidate) => candidate === folder || candidate.children.includes(folder)) ?? null);
  const words = query.trim().toLowerCase();
  const binned = filter === 'deleted';
  const shown = (binned ? deleted : characters)
    .filter(({ character }) => binned || filter === 'all' || (filter === 'loose' ? character.folder === null || !filed.has(character.folder) : folder !== null && holds(folder, character)))
    .filter(({ character }) => `${character.card.name} ${character.card.nickname ?? ''}`.toLowerCase().includes(words));
  if (byName) shown.sort((a, b) => a.character.card.name.localeCompare(b.character.card.name, 'ko'));

  const saveFailed = (failure: ApiFailure) => {
    toast({ message: describeFailure(failure) });
  };

  // Whether every character moved; a failure is shown and stops the rest.
  async function place(moves: Placement[]): Promise<boolean> {
    for (const { id, folder: to } of moves) {
      const saved = await store.update('character', id, (current) => ({ ...current, folder: to }));
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
    const saved =
      id === null
        ? await store.create('folder', parent ? { name: trimmed, parent: parent.id } : { name: trimmed })
        : await store.update('folder', id, (current) => ({ ...current, name: trimmed }));
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
      action: { label: '되돌리기', onClick: () => void restoreFolders([target, ...target.children], members) },
    });
  }

  async function restoreFolders(gone: FolderTree[], members: Placement[]) {
    for (const folder of gone) {
      const saved = await store.restore(folder);
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
          {!binned && (
            <Button variant="secondary" size="sm" icon={FolderInput} onClick={() => setPicked(picked ? null : new Set())}>
              {picked ? '고르기 끝' : '골라서 옮기기'}
            </Button>
          )}
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
              {(deleted.length > 0 || binned) && (
                <Tab
                  label="지운 캐릭터"
                  count={deleted.length}
                  current={binned}
                  onClick={() => {
                    setPicked(null);
                    setFilter('deleted');
                  }}
                />
              )}
            </Tabs>
            {!binned && <IconButton icon={FolderPlus} label="새 폴더" size="sm" onClick={() => setNaming({ id: null, name: '' })} />}
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
        {binned && <Text tone="muted">지운 캐릭터는 7일이 지나면 채팅과 함께 완전히 지워져요. 그 전에는 되살릴 수 있어요.</Text>}
        {shown.length > 0 ? (
          <CardGrid label="캐릭터">
            {shown.map((shelf) => {
              const { name } = shelf.character.card;
              const own: Menu = `card-${shelf.id}`;
              const close = () => setMenu(null);
              const cardMenu = (
                <Popover
                  open={menu === own}
                  onClose={close}
                  place="below-end"
                  label={`${name} 메뉴`}
                  trigger={<IconButton icon={MoreHorizontal} label={`${name} 메뉴`} size="sm" expanded={menu === own} onClick={() => setMenu(menu === own ? null : own)} />}
                >
                  {binned ? (
                    <>
                      <MenuItem
                        icon={RotateCcw}
                        label="되살리기"
                        onClick={() => {
                          close();
                          void restore(shelf);
                        }}
                      />
                      <MenuItem
                        icon={Trash2}
                        label="지금 지우기"
                        tone="warn"
                        onClick={() => {
                          close();
                          setPurging(shelf);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <MenuItem
                        icon={Copy}
                        label="사본 만들기"
                        onClick={() => {
                          close();
                          void copy(shelf);
                        }}
                      />
                      <MenuItem
                        icon={Trash2}
                        label="지우기"
                        tone="warn"
                        onClick={() => {
                          close();
                          void remove(shelf);
                        }}
                      />
                    </>
                  )}
                </Popover>
              );
              return (
                <FaceCard
                  key={shelf.id}
                  image={shelf.face}
                  name={name}
                  note={busy?.id === shelf.id ? busy.label : binned ? leftFor(shelf) : note(shelf)}
                  selected={picked ? picked.has(shelf.id) : null}
                  onClick={() => (picked ? toggle(shelf.id) : binned ? setMenu(own) : navigate(shelfTarget(shelf, wide)))}
                  menu={picked || busy?.id === shelf.id ? undefined : cardMenu}
                />
              );
            })}
          </CardGrid>
        ) : (
          <Text tone="muted">
            {words ? `“${query.trim()}” 검색 결과가 없어요.` : binned ? '지운 캐릭터가 없어요.' : '이 폴더는 비어 있어요. ‘골라서 옮기기’로 캐릭터를 넣어 보세요.'}
          </Text>
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
      {purging && (
        <Dialog title="완전히 지울까요?" onClose={() => setPurging(null)}>
          <Stack gap={16}>
            <Text>
              ‘{purging.character.card.name}’ {purging.chats.length ? `캐릭터와 채팅 ${purging.chats.length}개를` : '캐릭터를'} 지금 완전히 지워요. 되돌릴 수 없어요.
            </Text>
            <Row>
              <Button variant="secondary" onClick={() => setPurging(null)}>
                취소
              </Button>
              <Button
                icon={Trash2}
                onClick={() => {
                  setPurging(null);
                  void purge(purging);
                }}
              >
                완전히 지우기
              </Button>
            </Row>
          </Stack>
        </Dialog>
      )}
      {naming && (
        <NameDialog title={naming.id ? '폴더 이름 바꾸기' : naming.parent ? `‘${naming.parent.value.name}’ 안에 새 폴더` : '새 폴더'} value={naming.name} onSave={(name) => void saveFolder({ ...naming, name })} onClose={() => setNaming(null)} />
      )}
    </Screen>
  );
}

function note(shelf: CharacterShelf<ChatItem>): string {
  const latest = shelf.chats[0];
  return latest?.at ? `${ago(latest.at)} · 채팅 ${shelf.chats.length}개` : '아직 채팅이 없어요';
}

// How long a character in 지운 캐릭터 has left. Past its time it goes when the app next opens.
function leftFor(shelf: CharacterShelf<ChatItem>): string {
  const days = Math.ceil((shelf.character.deleted! + KEEP_DELETED - Date.now()) / DAY);
  const chats = shelf.chats.length ? ` · 채팅 ${shelf.chats.length}개` : '';
  return (days > 0 ? `${days}일 남음` : '곧 지워져요') + chats;
}
