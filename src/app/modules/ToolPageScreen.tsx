import type { Stored } from '../../model/kinds';
import { opensPage, ToolView } from '../common/ToolView';
import { moduleName } from '../common/words';
import { useTool } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Empty, NavBar, Screen } from '../ui';

export function ToolPageScreen({ stored, back }: { stored: Stored<'module'>; back: Back }) {
  const tool = useTool(stored.id);
  const title = moduleName(stored.value.name);
  return (
    <Screen width="wide" fill top={<NavBar title={title} {...backBar(back)} />}>
      {tool && opensPage(tool.value.manifest) ? <ToolView module={stored.id} chat={null} title={title} onClose={() => navigate(back.to)} /> : <Empty variant="section">이 플러그인에는 페이지가 없어요.</Empty>}
    </Screen>
  );
}
