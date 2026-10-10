import { addPersona } from '../../runtime/personas';
import { ACTS, newOf } from '../common/acts';
import { personaFaces, personaTexts } from '../common/alias';
import type { Frame } from '../common/frame';
import { useSearch } from '../common/useSearch';
import { PAGES } from '../common/words';
import { usePersonas, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Button, CardGrid, Empty, FaceCard, Row } from '../ui';

type Props = {
  onPick: (id: string) => void;
  current?: string;
  frame: Frame;
};

// Picking here opens a persona to edit; it changes no chat and not the current persona.
export function PersonaList({ onPick, current, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const search = useSearch(personaFaces(usePersonas()), '페르소나 검색', personaTexts);

  function add() {
    const id = crypto.randomUUID();
    void addPersona(store, { name: '새 페르소나', description: '', picture: null }, id).then((saved) => saved.ok || toast.failed(saved, '페르소나를 만들지 못했어요.'));
    onPick(id);
  }

  const actions = (
    <Button variant="secondary" icon={ACTS.create.icon} onClick={add}>
      {newOf('페르소나')}
    </Button>
  );
  const body = (
    <>
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {search.none && <Empty>{search.none}</Empty>}
      <CardGrid label="페르소나" variant="face" current={current} keys={search.found.map(({ persona }) => persona.id)}>
        {(index) => {
          const { persona: { id, value }, note, faint } = search.found[index]!;
          return <FaceCard image={value.picture} name={value.name} note={note} faint={faint} selected={null} current={current === id} tag={settings.persona === id ? '현재' : undefined} onClick={() => onPick(id)} />;
        }}
      </CardGrid>
    </>
  );
  return frame({ head: { title: PAGES.personas, actions }, body });
}
