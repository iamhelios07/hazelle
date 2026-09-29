import { FolderInput } from 'lucide-react';
import { useState } from 'react';
import type { ChatItem } from '../../../model/chat';
import { holds, KEEP_DAYS, matches, shownFolders, type CharacterShelf } from '../../../model/library';
import { NameDialog } from '../../common/NameDialog';
import { noResults } from '../../common/search';
import { useLibrary } from '../../session';
import { backBar } from '../../shell/router';
import type { Back } from '../../shell/routes';
import { Button, CardGrid, Empty, NavBar, Row, Screen, SearchField, Text } from '../../ui';
import { useCharacterActions } from '../useCharacterActions';
import { findFolder, useFolderActions } from '../useFolderActions';
import { CharacterCard } from './CharacterCard';
import { FolderTabs, type Filter, type Naming } from './FolderTabs';
import { MoveBar } from './MoveBar';
import { PurgeDialog } from './PurgeDialog';

// 캐릭터 둘러보기: every character as a face, filtered by folder, and where folders are made, renamed, emptied and filled.
export function GalleryScreen({ back }: { back: Back | null }) {
  const { characters, folders, deleted } = useLibrary();
  const characterActions = useCharacterActions();
  const { create, rename, move } = useFolderActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [byName, setByName] = useState(false);
  const [query, setQuery] = useState('');
  // The characters picked to move, or null while not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  // The character 지금 지우기 asks about before it goes for good.
  const [purging, setPurging] = useState<CharacterShelf<ChatItem> | null>(null);

  const filed = shownFolders(folders);
  const folder = findFolder(folders, filter) ?? null;
  const words = query.trim();
  const binned = filter === 'deleted';
  const shown = (binned ? deleted : characters)
    .filter(({ character }) => binned || filter === 'all' || (filter === 'loose' ? character.folder === null || !filed.has(character.folder) : folder !== null && holds(folder, character)))
    .filter(({ character }) => matches(character, query));
  if (byName) shown.sort((a, b) => a.character.card.name.localeCompare(b.character.card.name, 'ko'));

  // 지운 캐릭터 cannot be moved, so going there stops picking.
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
      <FolderTabs filter={filter} onFilter={choose} folder={folder} onName={setNaming} />
      {binned && <Text tone="muted">{`지운 캐릭터는 ${KEEP_DAYS}일이 지나면 채팅과 함께 완전히 지워져요. 그 전에는 되살릴 수 있어요.`}</Text>}
      {shown.length > 0 ? (
        <CardGrid label="캐릭터">
          {shown.map((shelf) => (
            <CharacterCard
              key={shelf.id}
              shelf={shelf}
              binned={binned}
              busy={characterActions.busy?.id === shelf.id ? characterActions.busy.label : null}
              picked={picked && picked.has(shelf.id)}
              onPick={() => toggle(shelf.id)}
              actions={characterActions}
              onPurge={() => setPurging(shelf)}
            />
          ))}
        </CardGrid>
      ) : (
        <Empty>{words ? noResults(words) : binned ? '지운 캐릭터가 없어요.' : '이 폴더는 비어 있어요. ‘골라서 옮기기’로 캐릭터를 넣어 보세요.'}</Empty>
      )}
      {picked && <MoveBar count={picked.size} onCancel={() => setPicked(null)} onMove={(to) => void movePicked(to)} />}
      {purging && (
        <PurgeDialog
          shelf={purging}
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
