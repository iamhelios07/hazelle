import { opensPage, ToolView } from '../common/ToolView';
import { moduleName } from '../common/words';
import { useStored, useTool } from '../session';
import { Empty, SidePanel } from '../ui';

export function ChatToolPanel({ chat, module, onClose }: { chat: string; module: string; onClose: () => void }) {
  const stored = useStored('module', module);
  const tool = useTool(module);
  const title = moduleName(stored?.value.name ?? '');
  return <SidePanel title={title} expandable fill onClose={onClose}>
    {tool && opensPage(tool.value.manifest) ? <ToolView module={module} chat={chat} title={title} onClose={onClose} /> : <Empty variant="section">도구를 열 수 없어요.</Empty>}
  </SidePanel>;
}
