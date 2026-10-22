import type { PromptSort } from '../../model/prompt';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { PromptList } from './PromptList';

export function PromptsScreen({ place, sort, back }: { place: string | null; sort: PromptSort | null; back: Back | null }) {
  return (
    <PromptList
      onPick={(id) => navigate({ kind: 'prompt', id, pane: null })}
      defaults
      place={place}
      sort={sort}
      onGo={(next) => navigate({ kind: 'prompts', place: next, sort: null })}
      frame={({ head, body }) => (
        <Screen width="page" top={<NavBar {...head} {...backBar(back)} />}>
          {body}
        </Screen>
      )}
    />
  );
}
