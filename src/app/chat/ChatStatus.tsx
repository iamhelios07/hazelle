import { PanelRight, PanelRightClose, PinOff } from 'lucide-react';
import { IconButton, MarginBox, SidePeek, Stack, StatusBox, StoryAside } from '../ui';
import { shownHtml } from './ChatMessage';
import type { OpenChat } from './useChat';

export function ChatStatusPeek({ chat }: { chat: OpenChat }) {
  const { status, held, canKeep, decor, actions } = chat;
  return (
    <SidePeek
      label="상태"
      open={held}
      onOpenChange={actions.hold}
      actions={
        <>
          {unmarkOnly(chat)}
          {canKeep && <IconButton icon={PanelRight} size="xs" label="옆에 두기" onClick={actions.keepStatus} />}
        </>
      }
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

// Laid out whether shown or not, so each box can tell whether it fits the margin, which 옆에 두기 needs.
export function ChatStatusAside({ chat }: { chat: OpenChat }) {
  const { status, aside, decor, actions } = chat;
  return (
    <StoryAside
      label="상태"
      shown={aside}
      actions={
        <>
          {unmarkOnly(chat)}
          <IconButton icon={PanelRightClose} size="xs" label="탭으로 접기" onClick={actions.foldStatus} />
        </>
      }
    >
      {status.map((box) =>
        box.drawn ? (
          <MarginBox key={box.id} html={shownHtml(box.drawn.html, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} onFit={(fits) => actions.fitStatus(box.id, fits)} />
        ) : null,
      )}
    </StoryAside>
  );
}

const unmark = ({ actions }: OpenChat, script: OpenChat['status'][number]) => (
  <IconButton icon={PinOff} size="xs" label={`상태창 지정 풀기 · ${script.name}`} onClick={() => actions.markStatus(script, false)} />
);

// One box has no head of its own: its 지정 풀기 sits with the drawer's or the margin's actions.
const unmarkOnly = (chat: OpenChat) => chat.status.length === 1 && unmark(chat, chat.status[0]!);
