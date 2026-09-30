import { PanelRight, PanelRightClose, PinOff } from 'lucide-react';
import { IconButton, SidePanel, SidePeek, Stack, StatusBox } from '../ui';
import { shownHtml } from './ChatMessage';
import type { OpenChat } from './useChat';

// 상태: the bot's status window (상태창 지정), each box from the latest message that drew it. Away from that message it
// peeks over the story from a tab at its edge, or with 옆에 두기 rests in the panel beside it, where there is room.
export function ChatStatusPeek({ chat }: { chat: OpenChat }) {
  const { peek, canKeep, actions } = chat;
  const keep = canKeep && <IconButton icon={PanelRight} size="xs" label="옆에 두기" onClick={actions.keepStatus} />;
  return (
    <SidePeek
      label="상태"
      open={peek}
      onOpenChange={actions.setPeek}
      actions={
        <>
          {unmarkOnly(chat)}
          {keep}
        </>
      }
    >
      <StatusBoxes chat={chat} />
    </SidePeek>
  );
}

export function ChatStatus({ chat }: { chat: OpenChat }) {
  return (
    <SidePanel title="상태" actions={unmarkOnly(chat)} close={{ icon: PanelRightClose, label: '탭으로 접기' }} onClose={chat.actions.foldStatus}>
      <StatusBoxes chat={chat} />
    </SidePanel>
  );
}

const unmark = ({ actions }: OpenChat, { script, name }: OpenChat['status'][number]) => (
  <IconButton icon={PinOff} size="xs" label={`상태창 지정 풀기 · ${name}`} onClick={() => actions.markStatus(script, false)} />
);

// One box has no head of its own: its 지정 풀기 sits with the drawer's or the panel's actions.
const unmarkOnly = (chat: OpenChat) => chat.status.length === 1 && unmark(chat, chat.status[0]!);

function StatusBoxes({ chat }: { chat: OpenChat }) {
  const { status, decor, actions } = chat;
  return (
    <Stack gap="section">
      {status.map((box) => (
        <StatusBox
          key={box.script}
          name={box.name}
          html={box.drawn && shownHtml(box.drawn.html, decor)}
          css={decor.css}
          onInert={actions.inert}
          actions={status.length > 1 && unmark(chat, box)}
        />
      ))}
    </Stack>
  );
}
