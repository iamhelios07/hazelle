import { Plus } from 'lucide-react';
import { useState } from 'react';
import { addPersona } from '../../runtime/personas';
import { aliasNotes, byName } from '../common/alias';
import type { Frame } from '../common/frame';
import { matches, noResults, SEARCH_FROM } from '../common/search';
import { PAGES } from '../common/words';
import { usePersonas, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Button, CardGrid, Empty, FaceCard, Row, SearchField } from '../ui';

type Props = {
  onPick: (id: string) => void;
  current?: string;
  frame: Frame;
};

// Picking here opens a persona to edit; it changes no chat and not the current persona.
export function PersonaList({ onPick, current, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const personas = usePersonas().toSorted((a, b) => byName(a.value, b.value));
  const settings = useSettings();
  const [query, setQuery] = useState('');
  const notes = aliasNotes(personas.map(({ value }) => value));
  const found = personas.flatMap((persona, index) => (matches(query, persona.value.name, persona.value.alias ?? '') ? [{ persona, ...notes[index]! }] : []));

  function add() {
    const id = crypto.randomUUID();
    void addPersona(store, { name: '새 페르소나', description: '', picture: null }, id).then((saved) => saved.ok || toast.failed(saved, '페르소나를 만들지 못했어요.'));
    onPick(id);
  }

  const actions = (
    <Button variant="secondary" size="sm" icon={Plus} onClick={add}>
      새 페르소나
    </Button>
  );
  const body = (
    <>
      {personas.length >= SEARCH_FROM && (
        <Row kind="toolbar">
          <SearchField size="sm" label="페르소나 검색" value={query} onChange={setQuery} />
        </Row>
      )}
      {found.length === 0 && query.trim() && <Empty>{noResults(query.trim())}</Empty>}
      <CardGrid label="페르소나" variant="face" current={current} keys={found.map(({ persona }) => persona.id)}>
        {(index) => {
          const { persona: { id, value }, note, faint } = found[index]!;
          return <FaceCard image={value.picture} name={value.name} note={note} faint={faint} selected={null} current={current === id} tag={settings.persona === id ? '현재' : undefined} onClick={() => onPick(id)} />;
        }}
      </CardGrid>
    </>
  );
  return frame({ head: { title: PAGES.personas, actions }, body });
}
