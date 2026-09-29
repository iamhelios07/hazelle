import type { Stored } from '../../model/kinds';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { PersonaEditor } from './PersonaEditor';

export function PersonaScreen({ stored, back }: { stored: Stored<'persona'>; back: Back }) {
  return (
    <PersonaEditor
      stored={stored}
      onRemoved={() => navigate({ kind: 'personas' })}
      frame={({ head, body }) => <Screen top={<NavBar {...head} {...backBar(back)} />}>{body}</Screen>}
    />
  );
}
