import type { Stored } from '../../model/kinds';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { PersonaEditor } from './PersonaEditor';

export function PersonaScreen({ stored, back }: { stored: Stored<'persona'>; back: Back }) {
  return (
    <PersonaEditor
      stored={stored}
      backLabel={back.label}
      onBack={() => navigate(back.to)}
      onRemoved={() => navigate({ kind: 'personas' })}
      frame={({ head, body }) => <Screen top={<NavBar {...head} />}>{body}</Screen>}
    />
  );
}
