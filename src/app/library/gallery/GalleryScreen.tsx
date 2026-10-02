import { FolderInput } from 'lucide-react';
import { useState } from 'react';
import type { ChatSummary } from '../../../model/chat';
import { holds, KEEP_DAYS, matches, shownFolders, type Shelf } from '../../../model/library';
import { NameDialog } from '../../common/NameDialog';
import { noResults } from '../../common/search';
import { BIN } from '../../common/words';
import { useLibrary } from '../../session';
import { backBar } from '../../shell/router';
import type { Back } from '../../shell/routes';
import { Button, CardGrid, Empty, List, NavBar, Row, Screen, SearchField, Section, Text } from '../../ui';
import { binnedCharacter, binnedChat, useCharacterActions, type Binned } from '../useCharacterActions';
import { findFolder, useFolderActions } from '../useFolderActions';
import { BinnedChat } from './BinnedChat';
import { CharacterCard } from './CharacterCard';
import { FolderTabs, type Filter, type Naming } from './FolderTabs';
import { MoveBar } from './MoveBar';
import { PurgeDialog } from './PurgeDialog';

// 캐릭터 둘러보기: every character as a face, filtered by folder, and where folders are made, renamed, emptied and filled.
export function GalleryScreen({ back }: { back: Back | null }) {
  const { characters, none, folders, deleted, deletedChats } = useLibrary();
  const characterActions = useCharacterActions();
  const { create, rename, move } = useFolderActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [byName, setByName] = useState(false);
  const [query, setQuery] = useState('');
  // The characters picked to move, or null while not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  // What 지금 지우기 asks about before it goes for good.
  const [purging, setPurging] = useState<Binned | null>(null);

  const filed = shownFolders(folders);
  const folder = findFolder(folders, filter) ?? null;
  const words = query.trim();
  const binned = filter === 'deleted';
  const shown = (binned ? deleted : characters)
    .filter(({ character }) => binned || filter === 'all' || (filter === 'loose' ? character.folder === null || !filed.has(character.folder) : folder !== null && holds(folder, character)))
    .filter(({ character }) => matches(character, query));
  if (byName) shown.sort((a, b) => a.character.card.name.localeCompare(b.character.card.name, 'ko'));
  // shelve lists only the deleted chats of a character not deleted, or of none.
  const shelfOf = ({ chat }: ChatSummary): Shelf<ChatSummary> => (chat.character === null ? none : characters.find((shelf) => shelf.id === chat.character)!);
  const shownChats = binned
    ? deletedChats.filter((item) => {
        const { character } = shelfOf(item);
        return item.title.toLowerCase().includes(words.toLowerCase()) || (character !== null && matches(character, query));
      })
    : [];
  const busy = (id: string) => (characterActions.busy?.id === id ? characterActions.busy.label : null);

  // 휴지통 cannot be moved, so going there stops picking.
  const choose = (next: Filter) => {
    if (next === 'deleted') setPicked(null);
    setFilter(next);
  };

  function saveFolder({ id, name, parent }: Naming) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setNaming(null);
    void (id === null ? create(trimmed, parent?.id ?? null) : rename(id, trimmed));
  }

  async function movePicked(to: string | null) {
    if (!picked) return;
    if (await move([...picked], to)) setPicked(null);
  }

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
        <SearchField size="sm" label={binned ? `${BIN} 검색` : '캐릭터 검색'} value={query} onChange={setQuery} />
        <Button variant="secondary" size="sm" onClick={() => setByName(!byName)}>
          {byName ? '이름 순' : '최근 대화 순'}
        </Button>
        {!binned && (
          <Button variant="secondary" size="sm" icon={FolderInput} onClick={() => setPicked(picked ? null : new Set())}>
            {picked ? '완료' : '골라서 옮기기'}
          </Button>
        )}
      </Row>
      <FolderTabs filter={filter} onFilter={choose} folder={folder} onName={setNaming} />
      {binned && <Text variant="note">{`${BIN}의 캐릭터와 채팅은 ${KEEP_DAYS}일이 지나면 완전히 지워져요. 그 전에는 되살릴 수 있어요.`}</Text>}
      {shown.length > 0 && (
        <CardGrid label="캐릭터">
          {shown.map((shelf) => (
            <CharacterCard
              key={shelf.id}
              shelf={shelf}
              binned={binned}
              busy={busy(shelf.id)}
              picked={picked && picked.has(shelf.id)}
              onPick={() => toggle(shelf.id)}
              actions={characterActions}
              onPurge={() => setPurging(binnedCharacter(shelf))}
            />
          ))}
        </CardGrid>
      )}
      {shownChats.length > 0 && (
        <Section title="채팅">
          <List label={`${BIN}의 채팅`}>
            {shownChats.map((item) => (
              <BinnedChat
                key={item.id}
                item={item}
                shelf={shelfOf(item)}
                busy={busy(item.id)}
                actions={characterActions}
                onPurge={() => setPurging(binnedChat(item))}
              />
            ))}
          </List>
        </Section>
      )}
      {shown.length === 0 && shownChats.length === 0 && (
        <Empty>{words ? noResults(words) : binned ? `${BIN}이 비어 있어요.` : '이 폴더는 비어 있어요. ‘골라서 옮기기’로 캐릭터를 넣어 보세요.'}</Empty>
      )}
      {picked && <MoveBar count={picked.size} onCancel={() => setPicked(null)} onMove={(to) => void movePicked(to)} />}
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
      {naming && (
        <NameDialog title={naming.id ? '폴더 이름 바꾸기' : naming.parent ? `‘${naming.parent.value.name}’ 안에 새 폴더` : '새 폴더'} value={naming.name} onSave={(name) => saveFolder({ ...naming, name })} onClose={() => setNaming(null)} />
      )}
    </Screen>
  );
}
