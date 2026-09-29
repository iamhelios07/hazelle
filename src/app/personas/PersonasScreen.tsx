import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { PersonaList } from './PersonaList';

export function PersonasScreen({ back }: { back: Back | null }) {
  const route = useRoute();
  return (
    <PersonaList
      onPick={(id) => navigate({ kind: 'persona', id })}
      current={route.kind === 'persona' ? route.id : undefined}
      frame={({ head, body }) => <Screen top={<NavBar {...head} {...backBar(back)} />}>{body}</Screen>}
    />
  );
}
