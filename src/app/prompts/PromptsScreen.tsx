import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Empty, NavBar, Screen } from '../ui';

export function PromptsScreen({ back }: { back: Back }) {
  return (
    <Screen top={<NavBar title="프롬프트" onBack={() => navigate(back.to)} backLabel={back.label} />}>
      <Empty>프롬프트 목록</Empty>
    </Screen>
  );
}
