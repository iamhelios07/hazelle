import { Bot, GitBranch, ImagePlus, Info, Languages, Package, Pin, PinOff, SquarePen } from 'lucide-react';
import { memo, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { resolveAssets, type PictureUrl } from '../../engine/assets';
import { storyHtml } from '../../engine/display';
import type { Box } from '../../engine/regex/scripts';
import { firstLine, shown } from '../../model/chat';
import { placeMark, withMarks, withoutMarks } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import type { Drawing } from '../../runtime/illustrate';
import type { Shown } from '../../runtime/talk';
import type { Translating } from '../../runtime/translate';
import { ACTS } from '../common/acts';
import { describeReplyError, describeTranslateFailure } from '../common/failure';
import { languageLabel, withRo } from '../common/languages';
import { timeOfDay } from '../common/time';
import { SHORTCUTS, titled } from '../shortcuts';
import { Avatar, Button, Divider, EditBox, Failure, IconButton, MarginPicture, Marker, Menu, MenuHeading, MenuItem, pressed, Story, StoryMessage, Switcher, Text, useMarginRoom, useMenuOpener, Waiting, type MenuHandle } from '../ui';
import { ChatPicture, slotOf } from './ChatPicture';
import type { ToolActions } from './toolMenu';
import type { ChatActions } from './useChat';
import { seenText } from './search';
import { useReveal } from './useReveal';

type Props = {
  message: Shown;
  // Editing starts from the stored text.
  text: string;
  // text with its 삽화's marks as the display left them, null for none (runtime/read-model ChatScreen).
  placed: string | null;
  // The shown version's pictures, oldest first, and its 삽화 run, if any.
  pictures: Stored<'illustration'>[];
  drawing: Drawing | null;
  // What the chat's tools put on the shown version, and the actions they offer on a message.
  badges: string[];
  toolActions: ToolActions[];
  decor: { bot: boolean; css: string; url: PictureUrl; buttons: 'live' | 'inert' };
  hosted: (Box & { id: string })[];
  offered: { id: string; name: string; marked: boolean }[];
  translating: Translating;
  awaited: boolean;
  flipped: boolean;
  replyNext: boolean;
  // Who replies: the chat's character, or with none, the model named on each reply.
  character: { name: string; image: string | null } | null;
  // Who the user plays: the chat's persona, which {{user}} names in the prompt, so the row shows the same name the
  // model reads; null for a deleted persona, shown as missing rather than as the account.
  me: { name: string; image: string | null } | null;
  modelName: string | null;
  // The greeting of a chat not started yet: its versions are the other greetings, and it has nothing
  // to regenerate, edit or delete.
  opening: boolean;
  busy: boolean;
  editing: { text: string; translation: string | null } | null;
  pinned: boolean;
  // One of the messages a memory record was made from, marked as StoryMessage's found; the collection seeks the first.
  found: number;
  // The search bar's current hit, marked until the bar moves on or closes.
  marked: boolean;
  // The search term as foldTerm makes it, lit in the text; '' while the bar is closed.
  term: string;
  branching: boolean;
  modelMenu: MenuHandle;
  actions: ChatActions;
};

// A card's blank greeting, which starts the chat with no first message.
const NO_GREETING = '첫 메시지 없이';

const NO_PERSONA = '페르소나 없음';

const CUT = { length: '잘림', 'no-terminal': '끊김', stopped: '중단됨' } as const;

export const ChatMessage = memo(function ChatMessage(props: Props) {
  const { message, text: original, placed, pictures, drawing, badges, toolActions, decor, hosted, offered, translating, awaited, flipped, replyNext, character, me, modelName, opening, busy, editing, pinned, found, marked, term, branching, modelMenu, actions } = props;
  const otherModel = useMenuOpener(modelMenu);
  const version = shown(message);
  const receipt = version.receipt;
  const mine = message.role === 'user';
  const live = message.live === version.id;
  const translation = version.translation ?? null;
  const translatingText = translating.live.get(version.id) ?? null;
  const untranslated = translating.failed.get(version.id) ?? null;
  const text = seenText(original, translation?.text ?? null, translatingText, flipped);
  const pending = !translatingText && (awaited || translatingText === '');
  const reveal = useReveal(version.id, text, live && !message.whole);
  // null follows the newest picture.
  const [page, setPage] = useState<string | null>(null);
  const slot = slotOf(drawing, pictures.find(({ id }) => id === page) ?? pictures.at(-1) ?? null);
  const paragraph = slot?.scene?.paragraph ?? null;
  const beside = useMarginRoom();
  const anchor = useRef<HTMLDivElement>(null);
  // A translation never goes through the display, so it takes its mark here, by the same paragraph.
  const originalShown = text === original;
  const storyText = paragraph === null ? reveal.text : originalShown ? withoutMarks(placed ?? original, paragraph) : withMarks(text, new Set([paragraph]));
  const html = useMemo(() => shownHtml(storyText, decor), [storyText, decor.bot, decor.url]);
  const running = drawing !== null && drawing.stage !== 'failed';
  const picture = slot && <ChatPicture slot={slot} message={message} pictures={pictures} onPage={setPage} running={running} url={decor.url} actions={actions} />;
  const failed = receipt?.state === 'failed';
  const empty = original === '';
  // An edited reply is the user's text now; its cut no longer applies.
  const cut = !live && !version.edited && receipt?.state === 'cut' ? receipt.cut : null;

  const editKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pressed(event, SHORTCUTS.cancelEdit.keys)) {
      event.preventDefault();
      actions.cancelEdit();
    } else if (pressed(event, SHORTCUTS.saveEdit.keys)) {
      event.preventDefault();
      actions.saveEdit(message, false);
    }
  };

  let body = null;
  if (editing !== null) {
    body = (
      <EditBox
        value={editing.text}
        onChange={(text) => actions.changeEdit({ text })}
        second={
          editing.translation === null
            ? undefined
            : mine
              ? { firstLabel: '보낸 메시지', label: '원문', value: editing.translation, onChange: (translation) => actions.changeEdit({ translation }) }
              : { firstLabel: '원문', label: '번역', value: editing.translation, onChange: (translation) => actions.changeEdit({ translation }) }
        }
        onKeyDown={editKeys}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={actions.cancelEdit}>
              취소
            </Button>
            {replyNext && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.saveEdit(message, true)}>
                저장하고 다시 생성
              </Button>
            )}
            <Button size="sm" onClick={() => actions.saveEdit(message, false)}>
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
        {receipt.continues && <Story html={shownHtml(original, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} />}
        <Failure
          title="응답 실패"
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
  } else if (opening && !version.text.trim()) {
    body = <Text variant="note">{`${NO_GREETING} 시작해요.`}</Text>;
  } else if (!empty || hosted.length > 0) {
    const box = ({ id, html }: Props['hosted'][number]) => (
      <div key={id} ref={actions.watch(id)}>
        <Story html={shownHtml(html, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} />
      </div>
    );
    body = (
      <>
        {hosted.filter(({ at }) => at === 'top').map(box)}
        {/* A message may be all box: a status window's script took every word of it. */}
        {!empty && (
          <Story
            html={html}
            css={decor.css}
            buttons={decor.buttons}
            onPress={actions.press}
            term={term}
            tone={pending ? 'faded' : 'plain'}
            cursor={live || reveal.revealing || (translatingText !== null && !flipped)}
            inlay={slot ? { mark: paragraph === null ? null : placeMark(paragraph), node: beside ? <div ref={anchor} /> : picture } : undefined}
          />
        )}
        {!empty && beside && picture && <MarginPicture anchor={anchor}>{picture}</MarginPicture>}
        {hosted.filter(({ at }) => at === 'bottom').map(box)}
      </>
    );
  }

  const again = { label: '다시 번역', disabled: translatingText !== null, onClick: () => actions.translate(message) };
  const translationMark =
    pending ? (
      <Marker reason="translation" label="번역 기다리는 중" />
    ) : untranslated ? (
      <Marker reason="translation" label={`번역하지 못했어요. ${describeTranslateFailure(untranslated)}`} action={again} />
    ) : translatingText === null && !flipped && translation?.receipt?.state === 'cut' ? (
      <Marker reason="translation" label="번역 잘림" action={again} />
    ) : null;
  const translateTool = !mine && !empty && !failed && (
    <IconButton icon={Languages} size="xs" label={translation ? '다시 번역' : '번역'} disabled={translatingText !== null} onClick={() => actions.translate(message)} />
  );
  const flip = () => actions.flipTranslation(message);
  // The language it went out in, not the setting now.
  const mark =
    !translation || editing !== null
      ? undefined
      : mine
        ? { label: translation.sentIn ? `${withRo(languageLabel(translation.sentIn))} 보냄` : '번역해 보냄', action: flipped ? '원문 보기' : '보낸 메시지 보기', onClick: flip }
        : { label: flipped ? '원문' : '번역', action: flipped ? '번역 보기' : '원문 보기', onClick: flip };

  const count = message.versions.length;
  // No call writes a greeting: its versions go round.
  const greeting = opening || version.greeting !== undefined;
  const nextLabel = message.selected === count - 1 && !greeting ? '다시 생성' : '다음';
  const [back, forward] = SHORTCUTS.swipe.keys;
  const after = (
    <>
      {editing === null && translationMark}
      {drawing?.stage === 'scene' && <Marker reason="illustration" label="장면 정하는 중" />}
      {cut && (
        <Marker
          reason={cut === 'stopped' ? 'stopped' : 'length'}
          label={cut === 'stopped' && empty ? '응답 전 중단됨' : CUT[cut]}
          action={
            !empty
              ? { label: '이어 쓰기', disabled: busy, onClick: () => actions.continue(message) }
              : cut === 'stopped'
                ? { label: '다시 시도', disabled: busy, onClick: () => actions.retry(message) }
                : undefined
          }
        />
      )}
      {!mine && count > 1 && editing === null && (
        <Switcher
          label={`${message.selected + 1} / ${count}`}
          prevDisabled={busy}
          nextDisabled={busy}
          nextLabel={nextLabel}
          prevTitle={titled('이전', [back])}
          nextTitle={titled(nextLabel, [forward])}
          onPrev={() => actions.swipe(message, -1)}
          onNext={() => actions.swipe(message, 1)}
          versions={message.versions.map((each) => firstLine(each.translation?.text ?? each.text) || NO_GREETING)}
          selected={message.selected}
          pickDisabled={busy}
          onPick={(index) => actions.pick(message, index)}
        />
      )}
    </>
  );

  const [only] = offered;
  const statusTool =
    offered.length === 1 ? (
      <IconButton
        icon={only!.marked ? PinOff : Pin}
        size="xs"
        label={`${only!.marked ? '상태창 지정 풀기' : '상태창으로 지정'} · ${only!.name}`}
        onClick={() => actions.markStatus(only!, !only!.marked)}
      />
    ) : offered.length > 1 ? (
      <Menu place="below-end" label="상태창으로 지정" trigger={(opener) => <IconButton icon={Pin} size="xs" label="상태창으로 지정" {...opener} />}>
        <MenuHeading>상태창으로 지정할 블록</MenuHeading>
        {offered.map((script) => (
          <MenuItem key={script.id} label={script.name} checked={script.marked} onClick={() => actions.markStatus(script, !script.marked)} />
        ))}
      </Menu>
    ) : null;

  const tools = live || message.unstored || editing !== null ? undefined : opening ? (
    <>
      {translateTool}
      {!empty && <IconButton icon={ACTS.copy.icon} size="xs" label={ACTS.copy.label} onClick={() => actions.copy(text)} />}
      {statusTool}
    </>
  ) : (
    <>
      {!mine && !greeting && !failed && !busy && <IconButton icon={ACTS.regenerate.icon} size="xs" label={ACTS.regenerate.label} onClick={() => actions.regenerate(message)} />}
      {!mine && failed && !busy && <IconButton icon={ACTS.retry.icon} size="xs" label={ACTS.retry.label} onClick={() => actions.retry(message)} />}
      {translateTool}
      {!mine && !empty && !failed && (
        <IconButton
          icon={ImagePlus}
          size="xs"
          label="삽화"
          disabled={running}
          onClick={() => {
            setPage(null);
            actions.illustrate(message);
          }}
        />
      )}
      {!failed && <IconButton icon={SquarePen} size="xs" label="수정" onClick={() => actions.edit(message)} />}
      {!empty && <IconButton icon={ACTS.copy.icon} size="xs" label={ACTS.copy.label} onClick={() => actions.copy(text)} />}
      {!failed && <IconButton icon={GitBranch} size="xs" label="여기서 분기" disabled={branching} onClick={() => void actions.branch(message)} />}
      {!mine && <IconButton icon={Info} size="xs" label="응답 정보" onClick={() => actions.info(message.id)} />}
      {statusTool}
      {!failed && toolActions.length > 0 && (
        <Menu place="below-end" label="도구" trigger={(opener) => <IconButton icon={Package} size="xs" label="도구" {...opener} />}>
          {toolActions.map((tool) => [
            <MenuHeading key={tool.module}>{tool.name}</MenuHeading>,
            ...tool.items.map((item) => <MenuItem key={`${tool.module}:${item.id}`} label={item.label} onClick={() => actions.toolAction(tool.module, item.id, message.id)} />),
          ])}
        </Menu>
      )}
      <Divider variant="tools" />
      <IconButton icon={ACTS.remove.icon} size="xs" label={ACTS.remove.label} onClick={() => actions.remove(message)} />
    </>
  );

  return (
    <StoryMessage
      avatar={mine ? <Avatar face={me?.name ?? '?'} image={me?.image} tone="you" /> : character ? <Avatar face={character.name} image={character.image} /> : <Avatar face={Bot} />}
      name={speaker(message, character, me, modelName)}
      time={timeOfDay(version.at)}
      mine={mine && editing === null}
      mark={mark}
      badges={badges}
      after={after}
      tools={tools}
      pinned={pinned}
      found={found}
      marked={marked}
      onTap={() => actions.pin(message)}
    >
      {body}
    </StoryMessage>
  );
}, sameRow);

function sameRow(previous: Props, next: Props): boolean {
  const { decor: aDecor, hosted: aHosted, offered: aOffered, character: aCharacter, me: aMe, translating: aTranslating, ...a } = previous;
  const { decor: bDecor, hosted: bHosted, offered: bOffered, character: bCharacter, me: bMe, translating: bTranslating, ...b } = next;
  if ((Object.keys(a) as (keyof typeof a)[]).some((key) => a[key] !== b[key])) return false;
  if (aDecor.bot !== bDecor.bot || aDecor.css !== bDecor.css || aDecor.url !== bDecor.url || aDecor.buttons !== bDecor.buttons) return false;
  if (aCharacter?.name !== bCharacter?.name || aCharacter?.image !== bCharacter?.image) return false;
  if (aMe?.name !== bMe?.name || aMe?.image !== bMe?.image) return false;
  if (aHosted.length !== bHosted.length || aHosted.some((box, index) => box.id !== bHosted[index]!.id || box.html !== bHosted[index]!.html || box.at !== bHosted[index]!.at)) return false;
  if (aOffered.length !== bOffered.length || aOffered.some((box, index) => box.id !== bOffered[index]!.id || box.name !== bOffered[index]!.name || box.marked !== bOffered[index]!.marked)) return false;
  const id = shown(next.message).id;
  return aTranslating.live.get(id) === bTranslating.live.get(id) && aTranslating.failed.get(id) === bTranslating.failed.get(id);
}

// The name a row goes by: the persona's for the user's, else the character's, or with none the model's.
export const speaker = (message: Shown, character: { name: string } | null, me: { name: string } | null, modelName: string | null) =>
  message.role === 'user' ? (me?.name ?? NO_PERSONA) : (character?.name ?? shown(message).receipt?.modelName ?? modelName ?? '모델');

// Without the bot's style, only the chat's own pictures show: its inlays, whose markup alone the plain display keeps.
export const shownHtml = (text: string, { bot, url }: Pick<Props['decor'], 'bot' | 'url'>) => resolveAssets(storyHtml(text, bot), bot ? url : (kind, id) => (kind === 'inlay' ? url(kind, id) : undefined));
