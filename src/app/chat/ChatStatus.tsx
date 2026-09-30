import { PinOff } from 'lucide-react';
import { IconButton, PinnedBox, SidePanel, Stack } from '../ui';
import { shownHtml } from './ChatMessage';
import type { OpenChat } from './useChat';

// 상태: the bot's boxes pinned beside the story (옆에 고정), each from the latest message that drew it.
export function ChatStatus({ chat }: { chat: OpenChat }) {
  const { status, decor, actions } = chat;
  return (
    <SidePanel title="상태" onClose={actions.closePanel}>
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
    </SidePanel>
  );
}
