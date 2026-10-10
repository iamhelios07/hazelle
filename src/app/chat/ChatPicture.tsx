import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { PictureUrl } from '../../engine/assets';
import { parseScene, sceneText, SIZES, type SceneInvalid } from '../../engine/illustrate';
import { paragraphsOf, type Scene } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import type { Drawing } from '../../runtime/illustrate';
import type { Shown } from '../../runtime/talk';
import { ACTS } from '../common/acts';
import { describeIllustrateFailure } from '../common/failure';
import { timeOfDay } from '../common/time';
import { Button, Dialog, Failure, IconButton, StoryPicture, Switcher, TextField } from '../ui';
import type { ChatActions, Reshaping } from './useChat';

// What a message's slot holds: a run under way or failed comes before the picture paged to. A failed run with no scene
// has no paragraph and goes at the message end.
export type Slot =
  | { kind: 'drawing'; scene: Scene }
  | { kind: 'failed'; drawing: Extract<Drawing, { stage: 'failed' }>; scene: Scene | null }
  | { kind: 'picture'; picture: Stored<'illustration'>; scene: Scene };

export function slotOf(drawing: Drawing | null, picture: Stored<'illustration'> | null): Slot | null {
  if (drawing?.stage === 'drawing') return { kind: 'drawing', scene: drawing.scene };
  if (drawing?.stage === 'failed') return { kind: 'failed', drawing, scene: drawing.scene };
  return picture && { kind: 'picture', picture, scene: picture.value.scene };
}

const LABEL = '삽화';

type Props = {
  slot: Slot;
  message: Shown;
  // The shown version's pictures, oldest first.
  pictures: Stored<'illustration'>[];
  onPage: (picture: string | null) => void;
  // A scene being written for the message, which another run must wait for.
  running: boolean;
  url: PictureUrl;
  actions: ChatActions;
};

export function ChatPicture({ slot, message, pictures, onPage, running, url, actions }: Props) {
  if (slot.kind === 'drawing') {
    const { width, height } = SIZES[slot.scene.shape];
    return <StoryPicture src={undefined} label={LABEL} width={width} height={height} status="그리는 중" />;
  }
  if (slot.kind === 'failed') {
    const { drawing } = slot;
    return (
      <Failure
        title={drawing.failure.kind === 'costs' ? '비용이 드는 이미지' : '삽화 실패'}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => actions.dismissIllustration(message.id)}>
              닫기
            </Button>
            {drawing.failure.kind === 'costs' ? (
              <Button size="sm" onClick={() => actions.draw(message.id, drawing.version, drawing.scene, true)}>
                그래도 만들기
              </Button>
            ) : (
              <Button size="sm" onClick={() => actions.draw(message.id, drawing.version, drawing.scene)}>
                {ACTS.retry.label}
              </Button>
            )}
          </>
        }
      >
        {describeIllustrateFailure(drawing.failure)}
      </Failure>
    );
  }
  const { picture } = slot;
  const { version, scene, sent } = picture.value;
  const at = pictures.indexOf(picture);
  const step = (by: -1 | 1) => onPage(pictures[(at + by + pictures.length) % pictures.length]!.id);
  const text = message.versions.find(({ id }) => id === version)?.text ?? '';
  const again = () => {
    onPage(null);
    actions.draw(message.id, version, scene);
  };
  return (
    <StoryPicture
      src={url('illustration', picture.id)}
      label={LABEL}
      width={sent.width}
      height={sent.height}
      foot={
        <>
          {pictures.length > 1 && (
            <Switcher
              label={`${at + 1} / ${pictures.length}`}
              prevDisabled={false}
              nextDisabled={false}
              nextLabel="다음"
              prevTitle="이전"
              nextTitle="다음"
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              versions={pictures.map(({ value }) => timeOfDay(value.at))}
              selected={at}
              pickDisabled={false}
              onPick={(index) => onPage(pictures[index]!.id)}
            />
          )}
          <IconButton icon={ACTS.regenerate.icon} size="xs" label="다시 그리기" disabled={running} onClick={again} />
          <IconButton icon={SlidersHorizontal} size="xs" label="어떻게 바꿀까요?" onClick={() => actions.reshape({ message: message.id, version, scene, paragraphs: paragraphsOf(text).length })} />
          <IconButton icon={ACTS.remove.icon} size="xs" label={ACTS.remove.label} onClick={() => actions.dropPicture(picture)} />
        </>
      }
    />
  );
}

const UNREAD: Record<SceneInvalid, (paragraphs: number) => string> = {
  unreadable: () => 'JSON 형식이 맞지 않아요.',
  fields: () => '빠진 항목이 있어요.',
  paragraph: (paragraphs) => `after는 1부터 ${paragraphs} 사이의 숫자여야 해요.`,
};

// 어떻게 바꿀까요?: the scene as the writer answers it, read back through parseScene before anything is drawn.
export function SceneDialog({ reshaping, actions }: { reshaping: Reshaping; actions: ChatActions }) {
  const [text, setText] = useState(() => sceneText(reshaping.scene));
  const [error, setError] = useState<string | undefined>();
  const close = () => actions.reshape(null);
  function submit() {
    const read = parseScene(text, reshaping.paragraphs);
    if (!read.ok) return setError(UNREAD[read.reason](reshaping.paragraphs));
    actions.draw(reshaping.message, reshaping.version, read.scene);
    close();
  }
  return (
    <Dialog
      title="어떻게 바꿀까요?"
      onClose={close}
      onSubmit={submit}
      actionsLayout="full"
      actions={
        <Button type="submit">
          다시 그리기
        </Button>
      }
    >
      <TextField label="장면" kind="key" lines={14} value={text} onChange={setText} error={error} help="after는 삽화가 들어갈 문단 번호, 나머지는 Danbooru 태그예요." />
    </Dialog>
  );
}
