import { Bot, Copy, Info, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { shown } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import { useSession } from '../session';
import { Avatar, Button, EditBox, Failure, Marker, Message as Row, Prose, Switcher, Tool, ToolDivider, Waiting } from '../ui';
import { describeReplyError } from './failure';
import { timeOfDay } from './time';

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
  onTap: () => void;
  onEdit: (text: string | null) => void;
  onSaveEdit: (andReply: boolean) => void;
  onSwipe: (step: -1 | 1) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onOtherModel: () => void;
  onCopy: () => void;
  onInfo: () => void;
  onDelete: () => void;
};

const CUT = { length: '여기서 잘렸어요', 'no-terminal': '여기서 끊겼어요', stopped: '여기서 멈췄어요' } as const;

// One message of design F3, with its version switcher, its markers and its tools.
export function ChatMessage(props: Props) {
  const { message, text, isLast, beforeLastReply, character, modelName, opening, busy, editing, pinned, onTap, onEdit, onSaveEdit, onSwipe } = props;
  const { username } = useSession();
  const version = shown(message);
  const receipt = version.receipt;
  const mine = message.role === 'user';
  const live = message.live === version.id;
  const failed = receipt?.state === 'failed';
  const empty = text === '';
  // An edited reply is the user's text now; its cut no longer applies.
  const cut = !live && !version.edited && receipt?.state === 'cut' ? receipt.cut : null;

  const editKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onEdit(null);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSaveEdit(false);
    }
  };

  let body = null;
  if (editing !== null) {
    body = (
      <EditBox
        value={editing}
        onChange={onEdit}
        onKeyDown={editKeys}
        hint="Esc 취소 · Ctrl+Enter 저장"
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => onEdit(null)}>
              취소
            </Button>
            {beforeLastReply && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => onSaveEdit(true)}>
                저장하고 답장 다시 받기
              </Button>
            )}
            <Button size="sm" onClick={() => onSaveEdit(false)}>
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
      <Failure
        title="답장을 받지 못했어요"
        actions={
          <>
            <Button size="sm" disabled={busy} onClick={props.onRetry}>
              다시 시도
            </Button>
            <Button variant="secondary" size="sm" onClick={props.onOtherModel}>
              다른 모델로
            </Button>
          </>
        }
      >
        {receipt.error ? describeReplyError(receipt.error) : '실패한 이유를 알 수 없어요.'}
      </Failure>
    );
  } else if (!empty || live) {
    body = <Prose text={text} cursor={live} />;
  }

  const count = message.versions.length;
  const after = (
    <>
      {cut && (
        <Marker
          reason={cut === 'stopped' ? 'stopped' : 'length'}
          label={cut === 'stopped' && empty ? '답장을 받기 전에 멈췄어요' : CUT[cut]}
          action={cut === 'stopped' && empty ? { label: '다시 받기', disabled: busy, onClick: props.onRetry } : undefined}
        />
      )}
      {!mine && isLast && count > 1 && editing === null && (
        <Switcher
          label={`${message.selected + 1} / ${count}`}
          prevDisabled={busy || message.selected === 0}
          nextDisabled={busy || (opening && message.selected === count - 1)}
          nextLabel={message.selected === count - 1 && !opening ? '새 답장 받기' : '다음'}
          onPrev={() => onSwipe(-1)}
          onNext={() => onSwipe(1)}
        />
      )}
    </>
  );

  const tools = live || editing !== null ? undefined : opening ? (
    <Tool icon={Copy} label="복사" onClick={props.onCopy} />
  ) : (
    <>
      {!mine && isLast && !failed && !busy && <Tool icon={RotateCcw} label="다시 생성" onClick={props.onRegenerate} />}
      {!mine && failed && !busy && <Tool icon={RotateCcw} label="다시 시도" onClick={props.onRetry} />}
      {!failed && <Tool icon={Pencil} label="수정" onClick={() => onEdit(version.text)} />}
      {!empty && <Tool icon={Copy} label="복사" onClick={props.onCopy} />}
      {!mine && <Tool icon={Info} label="답장 정보" onClick={props.onInfo} />}
      <ToolDivider />
      <Tool icon={Trash2} label="삭제 · 되돌릴 수 있어요" onClick={props.onDelete} />
    </>
  );

  return (
    <Row
      avatar={mine ? <Avatar face={username} tone="you" /> : character ? <Avatar face={character.name} image={character.image} /> : <Avatar face={Bot} />}
      name={mine ? username : (character?.name ?? receipt?.modelName ?? modelName ?? '모델')}
      time={timeOfDay(version.at)}
      mine={mine && editing === null}
      after={after}
      tools={tools}
      pinned={pinned}
      onTap={onTap}
    >
      {body}
    </Row>
  );
}
