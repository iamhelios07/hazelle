import { PanelRight, PinOff } from 'lucide-react';
import { IconButton, PinnedBox, SidePanel, SidePeek, Stack } from '../ui';
import { shownHtml } from './ChatMessage';
import type { OpenChat } from './useChat';

// 상태: the bot's boxes pinned beside the story (옆에 고정), each from the latest message that drew it. It peeks over
// the story from a tab at its edge, or with 옆에 두기 rests in the panel beside it, where there is room for one.
export function ChatStatusPeek({ chat }: { chat: OpenChat }) {
  const { peek, canKeep, actions } = chat;
  return (
    <SidePeek label="상태" open={peek} onOpenChange={actions.setPeek} actions={canKeep && <IconButton icon={PanelRight} size="xs" label="옆에 두기" onClick={actions.keepStatus} />}>
      <StatusBoxes chat={chat} />
    </SidePeek>
  );
}

export function ChatStatus({ chat }: { chat: OpenChat }) {
  return (
    <SidePanel title="상태" onClose={chat.actions.foldStatus}>
      <StatusBoxes chat={chat} />
    </SidePanel>
  );
}

function StatusBoxes({ chat }: { chat: OpenChat }) {
  const { status, decor, actions } = chat;
  return (
    <Stack gap="section">
      {status.map(({ script, name, html }) => (
        <PinnedBox
          key={script}
          name={name}
          html={html === null ? null : shownHtml(html, decor)}
          css={decor.css}
          onInert={actions.inert}
          actions={<IconButton icon={PinOff} size="xs" label="고정 풀기" onClick={() => actions.unpinBox(script)} />}
        />
      ))}
    </Stack>
  );
}
