import { FolderInput } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { Stored } from '../../../model/kinds';
import { characterTexts, KEEP_DAYS, pathName, pathOf, type CharacterShelf, type Shelf } from '../../../model/library';
import { useLab } from '../../common/labs';
import { NameDialog } from '../../common/NameDialog';
import { TASK_NAMES } from '../../common/prompt-words';
import { useSearch } from '../../common/useSearch';
import { BIN, MODEL_SETTINGS, PAGES } from '../../common/words';
import { useBin, useLibrary } from '../../session';
import { backBar } from '../../shell/router';
import { BIN_PLACE, type Back } from '../../shell/routes';
import { Avatar, Button, CardGrid, ChoiceGroup, Empty, List, NavBar, Row, Screen, Section, Text, useWide } from '../../ui';
import { ShelfFace, shelfName } from '../shelf';
import { binnedCharacter, binnedChat, binnedModule, binnedPersona, binnedProfile, binnedPrompt, useCharacterActions, type Binned } from '../useCharacterActions';
import { useFolderActions } from '../useFolderActions';
import { BinnedRow } from './BinnedRow';
import { CharacterCard } from './CharacterCard';
import { FolderPath, FolderTile, type Drop } from './FolderPlace';
import { FolderTabs, type Filter, type Naming } from './FolderTabs';
import { MoveBar } from './MoveBar';
import { PurgeDialog } from './PurgeDialog';
import { ShareDialog } from '../ShareDialog';

const ORDERS = [{ value: 'recent', label: '최근 대화' }, { value: 'name', label: '이름' }] as const;
const byName = new Intl.Collator('ko').compare;

// A row of 휴지통 other than a character, under the section it is listed in.
type BinEntry = { section: string; key: string; texts: string[]; render: () => ReactNode };
type Entry = CharacterShelf<ChatSummary> | BinEntry;
const isBinEntry = (entry: Entry): entry is BinEntry => 'section' in entry;

// place: where 실험실 탐색기식 폴더 stands (shell/routes BIN_PLACE); the folder tabs keep their own filter.
export function GalleryScreen({ place, back }: { place: string | null; back: Back | null }) {
  const { characters, none, folders, deleted, deletedChats, byCharacter, byFolder, loose } = useLibrary();
  const explorer = useLab('folders');
  const wide = useWide();
  const bin = useBin();
  const characterActions = useCharacterActions();
  const { create, rename, move } = useFolderActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [order, setOrder] = useState<'recent' | 'name'>('recent');
  // The characters picked to move, or null while not picking.
  const [picking, setPicked] = useState<Set<string> | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [purging, setPurging] = useState<Binned | null>(null);

  const contents = byFolder.get(filter);
  const folder = contents?.folder ?? null;
  // A folder gone meanwhile, on another device or by a stale link, leaves the explorer at the top.
  const here = explorer && place !== null ? (byFolder.get(place) ?? null) : null;
  const binned = explorer ? place === BIN_PLACE : filter === 'deleted';
  const candidates = binned ? deleted : explorer || filter === 'all' ? characters : filter === 'loose' ? loose : contents?.characters ?? [];
  // shelve lists only the deleted chats of a character not deleted, or of none.
  const shelfOf = ({ chat }: ChatSummary): Shelf<ChatSummary> => (chat.character === null ? none : byCharacter.get(chat.character)!);
  const busy = (id: string) => (characterActions.busy?.id === id ? characterActions.busy.label : null);
  const rows = <K extends 'module' | 'prompt' | 'persona' | 'profile'>(section: string, items: Stored<K>[], to: (stored: Stored<K>) => Binned, describe: (stored: Stored<K>) => string | undefined, face?: (stored: Stored<K>) => ReactNode): BinEntry[] =>
    items.map((stored) => {
      const item = to(stored);
      return { section, key: item.id, texts: [item.name], render: () => <BinnedRow key={item.id} item={item} face={face?.(stored)} description={describe(stored)} mark={stored.value} busy={busy(item.id)} actions={characterActions} onPurge={() => setPurging(item)} /> };
    });
  const binEntries: BinEntry[] = binned
    ? [
        ...deletedChats.map((item) => {
          const shelf = shelfOf(item);
          const binnedItem = binnedChat(item);
          return { section: '채팅', key: item.id, texts: [item.title, ...(shelf.character ? characterTexts(shelf.character) : [])], render: () => <BinnedRow key={item.id} item={binnedItem} face={<ShelfFace shelf={shelf} />} description={shelfName(shelf)} mark={item.chat} busy={busy(item.id)} actions={characterActions} onPurge={() => setPurging(binnedItem)} /> };
        }),
        ...rows(PAGES.modules, bin.modules, binnedModule, ({ value }) => value.description.trim() || undefined),
        ...rows(PAGES.prompts, bin.prompts, binnedPrompt, ({ value }) => value.task && `${TASK_NAMES[value.task]} ${PAGES.prompts}`),
        ...rows(PAGES.personas, bin.personas, binnedPersona, () => undefined, ({ value }) => <Avatar face={value.name} image={value.picture} tone="you" />),
        ...rows(MODEL_SETTINGS, bin.profiles, binnedProfile, () => undefined),
      ]
    : [];
  const search = useSearch<Entry>([...candidates, ...binEntries], binned ? `${BIN} 검색` : '캐릭터 검색', (entry) => (isBinEntry(entry) ? entry.texts : characterTexts(entry.character)));
  // The explorer lists one folder's own characters, and every folder's while searching.
  const placed = explorer && !binned && !search.words ? new Set<Entry>(here ? here.direct : loose) : null;
  const shown = search.found.filter((entry): entry is CharacterShelf<ChatSummary> => !isBinEntry(entry) && (!placed || placed.has(entry)));
  const folderCards = placed ? (here ? here.folder.children : folders) : [];
  if (order === 'name') shown.sort((a, b) => byName(a.character.card.name, b.character.card.name));
  const found = search.found.filter(isBinEntry);
  const listed = ['채팅', PAGES.modules, PAGES.prompts, PAGES.personas, MODEL_SETTINGS].map((title) => [title, found.filter(({ section }) => section === title)] as const).filter(([, items]) => items.length > 0);

  // 휴지통 cannot be moved: there no pick shows, and the folder tabs drop it on the way in.
  const picked = binned ? null : picking;
  const choose = (next: Filter) => {
    if (next === 'deleted') setPicked(null);
    setFilter(next);
  };

  function saveFolder({ id, name, parent }: Naming) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNaming(null);
    if (id === null) create(trimmed, parent?.id ?? null);
    else rename(id, trimmed);
  }

  function movePicked(to: string | null) {
    if (!picked) return;
    move([...picked], to);
    setPicked(null);
  }

  // A dragged card that is one of the pick moves the whole pick. Touch screens move by picking only.
  const dropInto: Drop | undefined = explorer && wide && !binned ? (to) => (id) => {
    const ids = picked?.has(id) ? [...picked] : [id];
    const moving = ids.filter((each) => (byCharacter.get(each)?.character.folder ?? null) !== to);
    if (moving.length > 0) move(moving, to);
    if (picked?.has(id)) setPicked(null);
  } : undefined;

  const toggle = (id: string) => {
    if (!picked) return;
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <Screen width="wide" top={back && <NavBar title="캐릭터" {...backBar(back)} />}>
      <Row kind="toolbar">
        {search.field}
        <ChoiceGroup label="정렬" showLabel layout="segmented" options={[...ORDERS]} value={order} onChange={setOrder} />
        {!binned && (
          <Button variant="secondary" size="sm" icon={FolderInput} onClick={() => setPicked(picked ? null : new Set())}>
            {picked ? '완료' : '선택해서 옮기기'}
          </Button>
        )}
      </Row>
      {explorer ? <FolderPath here={here} binned={binned} onName={setNaming} dropInto={dropInto} /> : <FolderTabs filter={filter} onFilter={choose} folder={folder} onName={setNaming} />}
      {binned && <Text variant="note">{`${BIN}에 있는 항목은 ${KEEP_DAYS}일이 지나면 영구 삭제돼요.`}</Text>}
      {folderCards.length + shown.length > 0 && (
        <CardGrid label="캐릭터" keys={[...folderCards.map(({ id }) => id), ...shown.map(({ id }) => id)]}>
          {(index) => { if (index < folderCards.length) { const card = folderCards[index]!; return <FolderTile key={card.id} folder={card} onName={setNaming} dropInto={dropInto} />; } const shelf = shown[index - folderCards.length]!; return (
            <CharacterCard
              key={shelf.id}
              shelf={shelf}
              binned={binned}
              busy={busy(shelf.id)}
              picked={picked && picked.has(shelf.id)}
              onPick={() => toggle(shelf.id)}
              actions={characterActions}
              onPurge={() => setPurging(binnedCharacter(shelf))}
              drag={dropInto !== undefined}
              where={explorer && search.words && shelf.character.folder ? pathName(pathOf(byFolder, shelf.character.folder)) || undefined : undefined}
            />
          ); }}
        </CardGrid>
      )}
      {listed.map(([title, items]) => (
        <Section key={title} title={title}>
          <List label={`${BIN}의 ${title}`} keys={items.map(({ key }) => key)}>{(index) => items[index]!.render()}</List>
        </Section>
      ))}
      {folderCards.length + shown.length === 0 && listed.length === 0 && (
        <Empty>{search.none ?? (binned ? '삭제한 항목이 없어요.' : here ? '비어 있는 폴더예요.' : '캐릭터가 없어요.')}</Empty>
      )}
      {picked && <MoveBar count={picked.size} onCancel={() => setPicked(null)} onMove={movePicked} />}
      {purging && (
        <PurgeDialog
          what={purging.what}
          onClose={() => setPurging(null)}
          onPurge={() => {
            setPurging(null);
            void characterActions.purge(purging);
          }}
        />
      )}
      {characterActions.sharing && (
        <ShareDialog character={characterActions.sharing.id} name={characterActions.sharing.character.card.name} onClose={characterActions.stopSharing} />
      )}
      {naming && (
        <NameDialog title={naming.id ? '폴더 이름 바꾸기' : naming.parent ? `'${naming.parent.value.name}' 안에 새 폴더` : '새 폴더'} value={naming.name} onSave={(name) => saveFolder({ ...naming, name })} onClose={() => setNaming(null)} />
      )}
    </Screen>
  );
}
