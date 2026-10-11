import { ExternalLink, Package } from 'lucide-react';
import { ToolSetting } from '../common/ToolSetting';
import { useTool } from '../session';
import { Button, Menu, Stack, ToolButton } from '../ui';
import type { ToolComposer } from './toolMenu';
import type { OpenChat } from './useChat';

// Each //@composer item of the chat's tools: its fields are the module's own, the same in every chat, as 삽화's are.
export function ChatComposerTools({ chat }: { chat: OpenChat }) {
  return chat.composerTools.map((tool) => <ComposerTool key={tool.module} tool={tool} onOpen={() => chat.actions.tool(tool.module)} />);
}

function ComposerTool({ tool, onOpen }: { tool: ToolComposer; onOpen: () => void }) {
  const settings = useTool(tool.module)?.value.settings ?? {};
  const on = tool.fields.some((field) => field.type === 'switch' && settings[field.key] === true);
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label={tool.name}
      trigger={(opener) => <ToolButton icon={Package} label={tool.label} phone="icon" detail={on ? '켜짐' : undefined} mark={on ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <Stack gap="related">
        {tool.fields.map((field) => <ToolSetting key={field.key} module={tool.module} field={field} value={settings[field.key]} />)}
        {tool.page && <Button variant="secondary" size="sm" icon={ExternalLink} onClick={onOpen}>열기</Button>}
      </Stack>
    </Menu>
  );
}
