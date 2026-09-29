import { Bot, Copy, GitBranch, Info, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { shown } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import { describeReplyError } from '../common/failure';
import { timeOfDay } from '../common/time';
import { useSession } from '../session';
import { hints, SHORTCUTS, titled } from '../shortcuts';
import { Avatar, Button, Divider, EditBox, Failure, IconButton, Marker, pressed, Prose, StoryMessage, Switcher, useMenuOpener, Waiting, type MenuHandle } from '../ui';
import type { ChatActions } from './useChat';

type Props = {
  message: Shown;
  // The shown version's text as it is displayed (engine/render). Editing starts from the stored text.
  text: string;
  isLast: boolean;
  // The user's message right before the last reply, which 저장하고 답장 다시 받기 answers again.
  beforeLastReply: boolean;
  // Who replies: the chat's character, or with none, the model named on each reply.
  character: { name: string; image: string | null } | null;
  // The chat's model, naming a reply still being written.
  modelName: string | null;
  // The greeting of a chat not started yet: its versions are the other greetings, and it has nothing
  // to regenerate, edit or delete.
  opening: boolean;
  // A reply is being written somewhere, so no other can start.
  busy: boolean;
  // The text in the edit box, while this message is being edited.
  editing: string | null;
  pinned: boolean;
  // A branch of this chat is being saved; one at a time.
  branching: boolean;
  // The header's model menu, which a failed reply's 다른 모델로 opens.
  modelMenu: MenuHandle;
  actions: ChatActions;
};

const CUT = { length: '여기서 잘렸어요', 'no-terminal': '여기서 끊겼어요', stopped: '여기서 멈췄어요' } as const;

// One message of design F3, with its version switcher, its markers and its tools.
export function ChatMessage(props: Props) {
  const { message, text, isLast, beforeLastReply, character, modelName, opening, busy, editing, pinned, branching, modelMenu, actions } = props;
  const { username } = useSession();
  const otherModel = useMenuOpener(modelMenu);
  const version = shown(message);
  const receipt = version.receipt;
  const mine = message.role === 'user';
  const live = message.live === version.id;
  const failed = receipt?.state === 'failed';
  const empty = text === '';
  // An edited reply is the user's text now; its cut no longer applies.
  const cut = !live && !version.edited && receipt?.state === 'cut' ? receipt.cut : null;

  const editKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pressed(event, SHORTCUTS.cancelEdit.keys)) {
      event.preventDefault();
      actions.edit(message, null);
    } else if (pressed(event, SHORTCUTS.saveEdit.keys)) {
      event.preventDefault();
      void actions.saveEdit(message, false);
    }
  };

  let body = null;
  if (editing !== null) {
    body = (
      <EditBox
        value={editing}
        onChange={(text) => actions.edit(message, text)}
        onKeyDown={editKeys}
        hint={hints(SHORTCUTS.cancelEdit, SHORTCUTS.saveEdit)}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => actions.edit(message, null)}>
              취소
            </Button>
            {beforeLastReply && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void actions.saveEdit(message, true)}>
                저장하고 답장 다시 받기
              </Button>
            )}
            <Button size="sm" onClick={() => void actions.saveEdit(message, false)}>
              저장
            </Button>
          </>
        }
      />
    );
  } else if (live && empty) {
    body = <Waiting />;
  } else if (failed) {
    body = (
      <>
        {/* A continuation that failed still holds the text it continued, and 다시 시도 continues it again. */}
        {receipt.continues && <Prose text={text} cursor={false} />}
        <Failure
          title="답장을 받지 못했어요"
          actions={
            <>
              <Button size="sm" disabled={busy} onClick={() => actions.retry(message)}>
                다시 시도
              </Button>
              <Button variant="secondary" size="sm" {...otherModel}>
                다른 모델로
              </Button>
            </>
          }
        >
          {receipt.error ? describeReplyError(receipt.error) : '실패한 이유를 알 수 없어요.'}
        </Failure>
      </>
    );
  } else if (!empty || live) {
    body = <Prose text={text} cursor={live} />;
  }

  const count = message.versions.length;
  const nextLabel = message.selected === count - 1 && !opening ? '새 답장 받기' : '다음';
  const [back, forward] = SHORTCUTS.swipe.keys;
  const after = (
    <>
      {cut && (
        <Marker
          reason={cut === 'stopped' ? 'stopped' : 'length'}
          label={cut === 'stopped' && empty ? '답장을 받기 전에 멈췄어요' : CUT[cut]}
          action={
            !empty
              ? { label: '이어 쓰기', disabled: busy, onClick: () => actions.continue(message) }
              : cut === 'stopped'
                ? { label: '다시 받기', disabled: busy, onClick: () => actions.retry(message) }
                : undefined
          }
        />
      )}
      {!mine && isLast && count > 1 && editing === null && (
        <Switcher
          label={`${message.selected + 1} / ${count}`}
          prevDisabled={busy || message.selected === 0}
          nextDisabled={busy || (opening && message.selected === count - 1)}
          nextLabel={nextLabel}
          prevTitle={titled('이전', [back])}
          nextTitle={titled(nextLabel, [forward])}
          onPrev={() => actions.swipe(message, -1)}
          onNext={() => actions.swipe(message, 1)}
        />
      )}
    </>
  );

  const tools = live || editing !== null ? undefined : opening ? (
    <IconButton icon={Copy} size="xs" label="복사" onClick={() => actions.copy(text)} />
  ) : (
    <>
      {!mine && isLast && !failed && !busy && <IconButton icon={RotateCcw} size="xs" label="다시 생성" onClick={() => actions.regenerate(message)} />}
      {!mine && failed && !busy && <IconButton icon={RotateCcw} size="xs" label="다시 시도" onClick={() => actions.retry(message)} />}
      {!failed && <IconButton icon={Pencil} size="xs" label="수정" onClick={() => actions.edit(message, version.text)} />}
      {!empty && <IconButton icon={Copy} size="xs" label="복사" onClick={() => actions.copy(text)} />}
      {!failed && <IconButton icon={GitBranch} size="xs" label="여기서 갈라지기" disabled={branching} onClick={() => void actions.branch(message)} />}
      {!mine && <IconButton icon={Info} size="xs" label="답장 정보" onClick={() => actions.info(message.id)} />}
      <Divider variant="tools" />
      <IconButton icon={Trash2} size="xs" label="삭제 · 되돌릴 수 있어요" onClick={() => void actions.remove(message)} />
    </>
  );

  return (
    <StoryMessage
      avatar={mine ? <Avatar face={username} tone="you" /> : character ? <Avatar face={character.name} image={character.image} /> : <Avatar face={Bot} />}
      name={mine ? username : (character?.name ?? receipt?.modelName ?? modelName ?? '모델')}
      time={timeOfDay(version.at)}
      mine={mine && editing === null}
      after={after}
      tools={tools}
      pinned={pinned}
      onTap={() => actions.pin(message)}
    >
      {body}
    </StoryMessage>
  );
}
