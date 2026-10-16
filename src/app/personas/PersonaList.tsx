import { addPersona } from '../../runtime/personas';
import { ACTS, importOf, newOf } from '../common/acts';
import { personaFaces, personaTexts } from '../common/alias';
import { useImport } from '../common/importing';
import { useSearch } from '../common/useSearch';
import { PAGES } from '../common/words';
import { usePersonas, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, CardGrid, Empty, FaceCard, NavBar, Row, Screen } from '../ui';

// Picking here opens a persona to edit; it changes no chat and not the current persona.
export function PersonaList({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const search = useSearch(personaFaces(usePersonas()), '페르소나 검색', personaTexts);
  const { pickPersonas } = useImport();

  function add() {
    const id = crypto.randomUUID();
    void addPersona(store, { name: '새 페르소나', description: '', picture: null }, id).then((saved) => saved.ok || toast.failed(saved, '페르소나를 만들지 못했어요.'));
    navigate({ kind: 'persona', id });
  }

  const actions = (
    <>
      <Button variant="secondary" icon={ACTS.import.icon} onClick={pickPersonas}>
        {importOf('페르소나')}
      </Button>
      <Button variant="secondary" icon={ACTS.create.icon} onClick={add}>
        {newOf('페르소나')}
      </Button>
    </>
  );
  const body = (
    <>
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {search.none && <Empty>{search.none}</Empty>}
      <CardGrid label="페르소나" variant="face" keys={search.found.map(({ persona }) => persona.id)}>
        {(index) => {
          const { persona: { id, value }, note, faint } = search.found[index]!;
          return <FaceCard image={value.picture} name={value.name} note={note} faint={faint} selected={null} tag={settings.persona === id ? '현재' : undefined} onClick={() => navigate({ kind: 'persona', id })} />;
        }}
      </CardGrid>
    </>
  );
  return <Screen width="page" top={<NavBar title={PAGES.personas} actions={actions} {...backBar(back)} />}>{body}</Screen>;
}
