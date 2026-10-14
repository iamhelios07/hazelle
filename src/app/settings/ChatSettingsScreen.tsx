import { PAGES } from '../common/words';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Columns, NavBar, Screen } from '../ui';
import { MemoryDefaults } from './MemoryDefaults';
import { ChatDetailDefaults } from './ChatDetailDefaults';
import { TranslationDefaults } from './TranslationDefaults';

export function ChatSettingsScreen({ back }: { back: Back | null }) {
  return (
    <Screen width="page" top={<NavBar title={PAGES.chat} {...backBar(back)} />}>
      <Columns min="panel">
        <MemoryDefaults />
        <TranslationDefaults />
      </Columns>
      <ChatDetailDefaults />
    </Screen>
  );
}
