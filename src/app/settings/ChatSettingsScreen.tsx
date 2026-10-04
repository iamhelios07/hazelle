import { PAGES } from '../common/words';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { NavBar, Screen } from '../ui';
import { MemoryDefaults } from './MemoryDefaults';
import { TranslationDefaults } from './TranslationDefaults';

export function ChatSettingsScreen({ back }: { back: Back | null }) {
  return (
    <Screen width="form" top={<NavBar title={PAGES.chat} {...backBar(back)} />}>
      <MemoryDefaults />
      <TranslationDefaults />
    </Screen>
  );
}
