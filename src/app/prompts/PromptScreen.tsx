import type { Stored } from '../../model/kinds';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Empty, NavBar, Screen } from '../ui';

export function PromptScreen({ stored, pane, back }: { stored: Stored<'prompt'>; pane: 'toggles' | null; back: Back }) {
  return (
    <Screen top={<NavBar title={stored.value.name} onBack={() => navigate(back.to)} backLabel={back.label} />}>
      <Empty>{pane === 'toggles' ? '토글' : '보내는 순서'}</Empty>
    </Screen>
  );
}
