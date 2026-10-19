import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { PictureUrl } from '../../engine/assets';
import { parseScene, sceneText, sentText, SIZES, type SceneInvalid } from '../../engine/illustrate';
import { shown } from '../../model/chat';
import { byParagraph, paragraphsOf, type Scene } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import type { Drawing, IllustrateFailure } from '../../runtime/illustrate';
import type { Shown } from '../../runtime/talk';
import { ACTS } from '../common/acts';
import { moduleName } from '../common/words';
import { describeIllustrateFailure } from '../common/failure';
import { withParticle } from '../common/particles';
import { timeOfDay } from '../common/time';
import { Button, Dialog, Failure, IconButton, SceneBoard, StoryPicture, Switcher, Text, TextField } from '../ui';
import { moveFigure, removeFigure } from './sceneEdit';
import type { IllustrationActions, Reshaping } from './useChatIllustrations';

// What a place of a message holds: a scene being drawn or failed comes before the picture paged to there. A run that
// failed with no scene has no paragraph and goes at the message end. pictures: the place's, oldest first.
export type Slot = { paragraph: number | null } & (
  | { kind: 'drawing'; scene: Scene }
  | { kind: 'failed'; failure: IllustrateFailure; version: string; scene: Scene | null }
  | { kind: 'picture'; picture: Stored<'illustration'>; pictures: Stored<'illustration'>[] }
);

// pictures: the shown version's. pages: by paragraph, the picture paged to; none follows the newest.
export function slotsOf(drawing: Drawing | null, pictures: Stored<'illustration'>[], pages: ReadonlyMap<number, string>): Slot[] {
  const slots = new Map<number, Slot>();
  for (const [paragraph, place] of byParagraph(pictures)) slots.set(paragraph, { paragraph, kind: 'picture', picture: place.find(({ id }) => id === pages.get(paragraph)) ?? place.at(-1)!, pictures: place });
  for (const { scene, failure } of drawing?.sketches ?? []) {
    const { paragraph } = scene;
    slots.set(paragraph, failure ? { paragraph, kind: 'failed', failure, version: drawing!.version, scene } : { paragraph, kind: 'drawing', scene });
  }
  const placed = [...slots.values()].sort((a, b) => a.paragraph! - b.paragraph!);
  return drawing?.failure ? [...placed, { paragraph: null, kind: 'failed', failure: drawing.failure, version: drawing.version, scene: null }] : placed;
}

const LABEL = '삽화';

type Props = {
  slot: Slot;
  message: Shown;
  onPage: (picture: string | null) => void;
  // A run under way for the message, which another must wait for.
  running: boolean;
  url: PictureUrl;
  // 삽화's 기능: off, a picture stays and is drawn again no more.
  draws: boolean;
  onDraw: IllustrationActions['draw'];
  onDismiss: IllustrationActions['dismissIllustration'];
  onReshape: IllustrationActions['reshape'];
  onDrop: IllustrationActions['dropPicture'];
};

export function ChatPicture({ slot, message, onPage, running, url, draws, onDraw, onDismiss, onReshape, onDrop }: Props) {
  if (slot.kind === 'drawing') {
    const { width, height } = SIZES[slot.scene.shape];
    return <StoryPicture src={undefined} label={LABEL} width={width} height={height} status="그리는 중" />;
  }
  if (slot.kind === 'failed') {
    const { failure, version, scene } = slot;
    return (
      <Failure
        title={failure.kind === 'costs' ? '비용이 드는 이미지' : '삽화 실패'}
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={running} onClick={() => onDismiss(message.id, scene)}>
              닫기
            </Button>
            {!draws ? null : failure.kind === 'costs' ? (
              <Button size="sm" disabled={running} onClick={() => onDraw(message.id, version, scene, true)}>
                그래도 만들기
              </Button>
            ) : (
              <Button size="sm" disabled={running} onClick={() => onDraw(message.id, version, scene)}>
                {ACTS.retry.label}
              </Button>
            )}
          </>
        }
      >
        {describeIllustrateFailure(failure)}
      </Failure>
    );
  }
  const { picture, pictures } = slot;
  const { value } = picture;
  const at = pictures.indexOf(picture);
  const step = (by: -1 | 1) => onPage(pictures[(at + by + pictures.length) % pictures.length]!.id);
  // The picture's own version may be one its message's edits replaced since.
  const { id: version, text } = shown(message);
  const again = (scene: Scene) => {
    onPage(null);
    onDraw(message.id, version, scene);
  };
  const { width, height } = 'tool' in value ? value : value.sent;
  return (
    <StoryPicture
      src={url('illustration', picture.id)}
      label={'tool' in value ? (value.caption ?? LABEL) : LABEL}
      width={width}
      height={height}
      pages={{ at, count: pictures.length, onStep: step }}
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
          {/* A tool's picture is redrawn by its tool, never here. */}
          {'tool' in value ? (
            <Text variant="note">{`${withParticle(moduleName(value.tool.name), '이/가')} 만든 이미지`}</Text>
          ) : draws && (
            <>
              <IconButton icon={ACTS.regenerate.icon} size="xs" label="다시 그리기" disabled={running} onClick={() => again(value.scene)} />
              <IconButton icon={SlidersHorizontal} size="xs" label="장면 바꾸기" onClick={() => onReshape({ message: message.id, version, scene: value.scene, sent: value.sent, paragraphs: paragraphsOf(text).length })} />
            </>
          )}
          <IconButton icon={ACTS.remove.icon} size="xs" label={ACTS.remove.label} onClick={() => onDrop(picture)} />
        </>
      }
    />
  );
}

const UNREAD: Record<SceneInvalid, (paragraphs: number) => string> = {
  unreadable: () => 'JSON 형식이 맞지 않아요.',
  fields: () => '빠진 항목이 있어요.',
  paragraph: (paragraphs) => `after에는 1부터 ${paragraphs} 사이의 숫자를 입력해야 해요.`,
};

// 어떻게 바꿀까요?: the scene as the writer answers it, read back through parseScene before anything is drawn. typed: the
// text as the user left it, null while it follows the scene; a typed text that does not read keeps the last scene that
// did on the board.
export function SceneDialog({ reshaping, onDraw, onClose }: { reshaping: Reshaping; onDraw: IllustrationActions['draw']; onClose: () => void }) {
  const [scene, setScene] = useState(reshaping.scene);
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const text = typed ?? sceneText(scene);
  const changed = sceneText(scene) !== sceneText(reshaping.scene);
  function type(value: string) {
    setTyped(value);
    const read = parseScene(value, reshaping.paragraphs);
    if (read.ok) setScene(read.scene);
  }
  function place(next: Scene) {
    setScene(next);
    setTyped(null);
    setError(undefined);
  }
  function submit() {
    const read = parseScene(text, reshaping.paragraphs);
    if (!read.ok) return setError(UNREAD[read.reason](reshaping.paragraphs));
    onDraw(reshaping.message, reshaping.version, read.scene);
    onClose();
  }
  const { width, height } = SIZES[scene.shape];
  return (
    <Dialog
      title="장면 바꾸기"
      onClose={onClose}
      onSubmit={submit}
      actionsLayout="full"
      actions={
        <Button type="submit">
          다시 그리기
        </Button>
      }
    >
      {scene.characters.length > 0 && (
        <SceneBoard
          label="인물 위치"
          help="끌거나 방향키로 옮기면 그 자리에 그려요. ×로 뺀 인물은 그리지 않아요."
          width={width}
          height={height}
          figures={scene.characters}
          onMove={(index, x, y) => place(moveFigure(scene, index, x, y))}
          onRemove={(index) => place(removeFigure(scene, index))}
        />
      )}
      <TextField label="장면" kind="key" lines={14} value={text} onChange={type} error={error} help="after는 삽화가 들어갈 문단 번호이고, 나머지는 Danbooru 태그예요." />
      <TextField label={changed ? '지난번에 보낸 태그' : '보낸 태그'} kind="key" lines={6} readOnly value={sentText(reshaping.scene, reshaping.sent)} onChange={() => {}} help="이름이 프로필과 같은 인물은 외모와 옷을 프로필의 태그로 바꿔 보내요. 장면을 고쳐 다시 그려도 같은 규칙을 거쳐요." />
    </Dialog>
  );
}
