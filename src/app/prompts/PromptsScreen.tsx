import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { Empty, NavBar, Screen } from '../ui';

export function PromptsScreen({ back }: { back: Back | null }) {
  return (
    <Screen top={<NavBar title="프롬프트" {...backBar(back)} />}>
      <Empty>프롬프트 목록</Empty>
    </Screen>
  );
}
