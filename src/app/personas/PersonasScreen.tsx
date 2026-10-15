import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { PersonaList } from './PersonaList';

export function PersonasScreen({ back }: { back: Back | null }) {
  return (
    <PersonaList
      onPick={(id) => navigate({ kind: 'persona', id })}
      frame={({ head, body }) => <Screen width="page" top={<NavBar {...head} {...backBar(back)} />}>{body}</Screen>}
    />
  );
}
