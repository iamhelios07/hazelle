import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { MemoryDefaults } from './MemoryDefaults';
import { PromptList } from './PromptList';

export function PromptsScreen({ back }: { back: Back | null }) {
  return (
    <PromptList
      onPick={(id) => navigate({ kind: 'prompt', id, pane: null })}
      after={<MemoryDefaults />}
      frame={({ head, body }) => (
        <Screen width="wide" top={<NavBar {...head} {...backBar(back)} />}>
          {body}
        </Screen>
      )}
    />
  );
}
