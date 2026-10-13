import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { PromptList } from './PromptList';

export function PromptsScreen({ back }: { back: Back | null }) {
  return (
    <PromptList
      onPick={(id) => navigate({ kind: 'prompt', id, pane: null })}
      defaults
      frame={({ head, body }) => (
        <Screen width="page" top={<NavBar {...head} {...backBar(back)} />}>
          {body}
        </Screen>
      )}
    />
  );
}
