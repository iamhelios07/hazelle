import { FolderInput } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { Stored } from '../../../model/kinds';
import { KEEP_DAYS, matches, type Shelf } from '../../../model/library';
import { NameDialog } from '../../common/NameDialog';
import { noResults } from '../../common/search';
import { TASK_NAMES } from '../../common/prompt-words';
import { BIN, PAGES } from '../../common/words';
import { useBin, useLibrary } from '../../session';
import { backBar } from '../../shell/router';
import type { Back } from '../../shell/routes';
import { Avatar, Button, CardGrid, Empty, List, NavBar, Row, Screen, SearchField, Section, Text } from '../../ui';
import { ShelfFace, shelfName } from '../shelf';
import { binnedCharacter, binnedChat, binnedModule, binnedPersona, binnedProfile, binnedPrompt, useCharacterActions, type Binned } from '../useCharacterActions';
import { useFolderActions } from '../useFolderActions';
import { BinnedRow } from './BinnedRow';
import { CharacterCard } from './CharacterCard';
import { FolderTabs, type Filter, type Naming } from './FolderTabs';
import { MoveBar } from './MoveBar';
import { PurgeDialog } from './PurgeDialog';

const MODEL_SETTINGS = '모델 설정';

export function GalleryScreen({ back }: { back: Back | null }) {
  const { characters, none, deleted, deletedChats, byCharacter, byFolder, loose } = useLibrary();
  const bin = useBin();
  const characterActions = useCharacterActions();
  const { create, rename, move } = useFolderActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [byName, setByName] = useState(false);
  const [query, setQuery] = useState('');
  // The characters picked to move, or null while not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [purging, setPurging] = useState<Binned | null>(null);

  const contents = byFolder.get(filter);
  const folder = contents?.folder ?? null;
  const words = query.trim();
  const binned = filter === 'deleted';
  const candidates = binned ? deleted : filter === 'all' ? characters : filter === 'loose' ? loose : contents?.characters ?? [];
  const shown = useMemo(() => {
    const result = candidates.filter(({ character }) => matches(character, query));
    if (byName) result.sort((a, b) => a.character.card.name.localeCompare(b.character.card.name, 'ko'));
    return result;
  }, [candidates, query, byName]);
  // shelve lists only the deleted chats of a character not deleted, or of none.
  const shelfOf = ({ chat }: ChatSummary): Shelf<ChatSummary> => (chat.character === null ? none : byCharacter.get(chat.character)!);
  const named = (name: string) => name.toLowerCase().includes(words.toLowerCase());
  const shownChats = binned
    ? deletedChats.filter((item) => {
        const { character } = shelfOf(item);
        return named(item.title) || (character !== null && matches(character, query));
      })
    : [];
  const busy = (id: string) => (characterActions.busy?.id === id ? characterActions.busy.label : null);
  const rows = <K extends 'module' | 'prompt' | 'persona' | 'profile'>(items: Stored<K>[], to: (stored: Stored<K>) => Binned, describe: (stored: Stored<K>) => string | undefined, face?: (stored: Stored<K>) => ReactNode) =>
    items.flatMap((stored) => {
      const item = to(stored);
      if (!binned || !named(item.name)) return [];
      return [{ key: item.id, render: () => <BinnedRow key={item.id} item={item} face={face?.(stored)} description={describe(stored)} mark={stored.value} busy={busy(item.id)} actions={characterActions} onPurge={() => setPurging(item)} /> }];
    });
  const sections: [string, { key: string; render: () => ReactNode }[]][] = [
    ['채팅', shownChats.map((item) => ({ key: item.id, render: () => <BinnedRow key={item.id} item={binnedChat(item)} face={<ShelfFace shelf={shelfOf(item)} />} description={shelfName(shelfOf(item))} mark={item.chat} busy={busy(item.id)} actions={characterActions} onPurge={() => setPurging(binnedChat(item))} /> }))],
    [PAGES.modules, rows(bin.modules, binnedModule, ({ value }) => value.description.trim() || undefined)],
    [PAGES.prompts, rows(bin.prompts, binnedPrompt, ({ value }) => value.task && `${TASK_NAMES[value.task]} ${PAGES.prompts}`)],
    [PAGES.personas, rows(bin.personas, binnedPersona, () => undefined, ({ value }) => <Avatar face={value.name} image={value.picture} tone="you" />)],
    [MODEL_SETTINGS, rows(bin.profiles, binnedProfile, () => undefined)],
  ];
  const listed = sections.filter(([, items]) => items.length > 0);

  // 휴지통 cannot be moved, so going there stops picking.
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
      {binned && <Text variant="note">{`${BIN}에 든 것은 ${KEEP_DAYS}일이 지나면 완전히 지워져요. 그 전에는 되살릴 수 있어요.`}</Text>}
      {shown.length > 0 && (
        <CardGrid label="캐릭터" keys={shown.map(({ id }) => id)}>
          {(index) => { const shelf = shown[index]!; return (
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
          ); }}
        </CardGrid>
      )}
      {listed.map(([title, items]) => (
        <Section key={title} title={title}>
          <List label={`${BIN}의 ${title}`} keys={items.map(({ key }) => key)}>{(index) => items[index]!.render()}</List>
        </Section>
      ))}
      {shown.length === 0 && listed.length === 0 && (
        <Empty>{words ? noResults(words) : binned ? `${BIN}이 비어 있어요.` : '이 폴더는 비어 있어요. ‘골라서 옮기기’로 캐릭터를 넣어 보세요.'}</Empty>
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
      {naming && (
        <NameDialog title={naming.id ? '폴더 이름 바꾸기' : naming.parent ? `‘${naming.parent.value.name}’ 안에 새 폴더` : '새 폴더'} value={naming.name} onSave={(name) => saveFolder({ ...naming, name })} onClose={() => setNaming(null)} />
      )}
    </Screen>
  );
}
