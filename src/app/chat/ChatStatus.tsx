import { PinOff } from 'lucide-react';
import { IconButton, SidePeek, Stack, StatusBox } from '../ui';
import { shownHtml } from './ChatMessage';
import type { OpenChat } from './useChat';

export function ChatStatusPeek({ chat }: { chat: OpenChat }) {
  const { status, held, decor, actions } = chat;
  return (
    <SidePeek
      label="상태"
      open={held}
      onOpenChange={actions.hold}
      actions={unmarkOnly(chat)}
    >
      <Stack gap="section">
        {status.map((box) => (
          <StatusBox
            key={box.id}
            name={box.name}
            html={box.drawn && shownHtml(box.drawn.html, decor)}
            css={decor.css}
            buttons={decor.buttons}
            onPress={actions.press}
            actions={status.length > 1 && unmark(chat, box)}
          />
        ))}
      </Stack>
    </SidePeek>
  );
}

const unmark = ({ actions }: OpenChat, script: OpenChat['status'][number]) => (
  <IconButton icon={PinOff} size="xs" label={`상태창 지정 풀기 · ${script.name}`} onClick={() => actions.markStatus(script, false)} />
);

// One box has no head of its own: its 지정 풀기 sits with the drawer's actions.
const unmarkOnly = (chat: OpenChat) => chat.status.length === 1 && unmark(chat, chat.status[0]!);
