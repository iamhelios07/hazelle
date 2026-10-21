import { Bookmark, Bot, Info, Languages, Pin, PinOff, SquarePen } from 'lucide-react';
import { memo, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { resolveAssets, type PictureUrl } from '../../engine/assets';
import { storyHtml } from '../../engine/display';
import type { Box } from '../../engine/regex/scripts';
import { firstLine, handEdited, shown, translationOutdated, type Message } from '../../model/chat';
import type { PictureSizes } from '../../engine/illustrate';
import { placeMark, withMarks, withoutMarks } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import { runs, type Drawing } from '../../runtime/illustrate';
import type { Shown } from '../../runtime/talk';
import type { Translating } from '../../runtime/translate';
import { ACTS } from '../common/acts';
import { MASCOT_PICTURES } from '../common/mascots';
import { BOOKMARK } from '../common/words';
import { describeFailedReply, describeTranslateFailure } from '../common/failure';
import { languageLabel } from '../common/languages';
import { withParticle } from '../common/particles';
import { timeOfDay } from '../common/time';
import { AGENTS_WAITING, DISCOUNT_STOPPING, DISCOUNT_WAITING, POLISHING, PRE_READ_WAITING, RETRYING } from '../common/words';
import type { Preparing } from '../../runtime/talk';
import { SHORTCUTS, titled } from '../shortcuts';
import { MASCOTS } from '../../model/mascot';
import { Avatar, Button, Divider, EditBox, Failure, IconButton, Marker, MascotRemark, Menu, MenuHeading, MenuItem, MoreMenu, pressed, SelectionButton, Story, StoryMessage, Switcher, Text, useMenuOpener, Waiting, type MenuHandle } from '../ui';
import { useNow } from './ChatCache';
import { ChatPicture } from './ChatPicture';
import { linesOf, markPart, PART_MARK, partOf } from './editPart';
import { picturePlaces } from './picturePlaces';
import type { ToolActions } from './toolMenu';
import type { ChatActions } from './useChat';
import type { Editing, EditPart } from './useMessageEdit';
import { seenText } from './search';
import { useReveal } from './useReveal';
import { useSelectedPart } from './useSelectedPart';
import { withOriginal } from './withOriginal';

const PREPARING: Record<Preparing, string> = { preread: PRE_READ_WAITING, agents: AGENTS_WAITING };

type Props = {
  message: Shown;
  // Editing starts from the stored text.
  text: string;
  // text with its 삽화's marks as the display left them, null for none (runtime/read-model ChatScreen).
  placed: string | null;
  // The shown version's pictures, oldest first, and its 삽화 run, if any.
  pictures: Stored<'illustration'>[];
  drawing: Drawing | null;
  // The shown version's 마스코트 line, null with none or with the 기능 off; fresh until opened once on this page.
  remark: Stored<'remark'> | null;
  fresh: boolean;
  // What the chat's tools put on the shown version, and the actions they offer on a message.
  badges: string[];
  toolActions: ToolActions[];
  decor: { bot: boolean; css: string; url: PictureUrl; buttons: 'live' | 'inert' };
  hosted: (Box & { id: string })[];
  offered: { id: string; name: string; marked: boolean }[];
  translating: Translating;
  // 번역's and 삽화's 기능: off, the message offers neither.
  canTranslate: boolean;
  canIllustrate: boolean;
  pictureSizes: PictureSizes;
  awaited: boolean;
  // Its post agents are rewriting the reply shown (runtime/agents Polisher).
  polishing: boolean;
  flipped: boolean;
  showOriginal: boolean;
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
  // The chat's last message: deleting any other asks whether the ones after it go too.
  last: boolean;
  busy: boolean;
  editing: Editing | null;
  bookmarked: boolean;
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

const CUT = { length: '잘림', 'no-terminal': '끊김', stopped: '중단됨', refused: '차단됨' } as const;
const MARK = { length: 'length', 'no-terminal': 'length', stopped: 'stopped', refused: 'refused' } as const;

export const ChatMessage = memo(function ChatMessage(props: Props) {
  const { message, text: original, placed, pictures, drawing, remark, fresh, badges, toolActions, decor, hosted, offered, translating, canTranslate, canIllustrate, pictureSizes, awaited, polishing, flipped, showOriginal, replyNext, character, me, modelName, opening, last, busy, editing, bookmarked, found, marked, term, branching, modelMenu, actions } = props;
  const otherModel = useMenuOpener(modelMenu);
  const version = shown(message);
  const receipt = version.receipt;
  const mine = message.role === 'user';
  const live = message.live === version.id;
  const translation = version.translation ?? null;
  // A message sent translated keeps what the user typed as its translation; another translation offers a new one.
  const sentTranslated = translation?.sentIn !== undefined;
  const translatingText = translating.live.get(version.id) ?? null;
  const untranslated = translating.failed.get(version.id) ?? null;
  // 다듬기 전 답 보기 of a reply its post agents rewrote: the text as the model wrote it, as it is stored.
  const hasRaw = version.raw !== undefined && version.raw !== version.text;
  const [rawShown, setRawShown] = useState(false);
  const raw = hasRaw && rawShown;
  const text = seenText(original, version, translatingText, flipped);
  const pending = !translatingText && (awaited || translatingText === '');
  const reveal = useReveal(version.id, text, live && !message.whole);
  const places = picturePlaces(drawing, pictures);
  const paragraphs = new Set(places.flatMap(({ paragraph }) => (paragraph === null ? [] : [paragraph])));
  // A translation never goes through the display, so it takes its marks here, by the same paragraphs.
  const originalShown = text === original;
  const translatedText = !paragraphs.size ? reveal.text : originalShown ? withoutMarks(placed ?? original, paragraphs) : withMarks(text, paragraphs);
  // A message sent translated keeps 보낸 메시지 보기 only. Not left off while editing a part: findPart's lines are this text's.
  const both = showOriginal && translation !== null && !sentTranslated && translatingText === null && !originalShown;
  const storyText = both ? withOriginal(translatedText, original) : translatedText;
  const part = editing?.part ?? null;
  const drawnText = part ? markPart(storyText, part.shown) : storyText;
  const html = useMemo(() => shownHtml(drawnText, decor), [drawnText, decor.bot, decor.url]);
  const story = useRef<HTMLDivElement>(null);
  const running = drawing !== null && runs(drawing);
  const illustrations = places.map((place) => ({
    mark: place.paragraph === null ? null : placeMark(place.paragraph),
    node: <ChatPicture key={place.paragraph ?? 'run'} place={place} message={message} running={running} url={decor.url} draws={canIllustrate} sizes={pictureSizes} onDraw={actions.draw} onDismiss={actions.dismissIllustration} onReshape={actions.reshape} onDrop={actions.dropPicture} />,
  }));
  const failed = receipt?.state === 'failed';
  const empty = original === '';
  // An edited reply is the user's text now; its cut no longer applies.
  const cut = !live && !handEdited(version) && receipt?.state === 'cut' ? receipt.cut : null;

  const editKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (pressed(event, SHORTCUTS.cancelEdit.keys)) {
      event.preventDefault();
      actions.cancelEdit();
    } else if (pressed(event, SHORTCUTS.saveEdit.keys)) {
      event.preventDefault();
      actions.saveEdit(message, false);
    }
  };

  const findPart = (pieces: string[]) => {
    const side: EditPart['side'] = translation && !flipped ? 'translation' : 'text';
    const source = side === 'text' ? version.text : translation!.text;
    const found = partOf(source, pieces);
    const drawn = found && partOf(storyText, linesOf(source, found).split('\n'));
    return found && drawn ? { ...found, side, shown: drawn } : null;
  };
  const selected = useSelectedPart(story, findPart, editing === null && !live && !message.unstored && !opening && !failed && !empty);

  let body = null;
  if (editing !== null && !part) {
    body = (
      <EditBox
        value={editing.text}
        onChange={(text) => actions.changeEdit({ text })}
        second={
          editing.translation === null
            ? undefined
            : sentTranslated
              ? { firstLabel: '보낸 메시지', label: '원문', value: editing.translation, onChange: (translation) => actions.changeEdit({ translation }) }
              : { firstLabel: '원문', label: '번역', value: editing.translation, onChange: (translation) => actions.changeEdit({ translation }) }
        }
        onKeyDown={editKeys}
      />
    );
  } else if (live && empty) {
    const waiting = message.stopping ? DISCOUNT_STOPPING : message.batch ? DISCOUNT_WAITING : message.retrying ? RETRYING : message.preparing ? PREPARING[message.preparing] : null;
    body = waiting ? <Waiting note={waiting} /> : <Elapsed thinking={Boolean(version.reasoning)} />;
  } else if (failed) {
    body = (
      <>
        {/* Text that came before the failure (a connection lost midway, a continuation that failed) is saved, and stays shown. */}
        {!empty && <Story html={shownHtml(original, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} />}
        <Failure
          title="응답 실패"
          actions={
            <>
              <Button size="sm" disabled={busy} onClick={() => actions.retry(message)}>
                {ACTS.retry.label}
              </Button>
              {!empty && !receipt.continues && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.continue(message)}>
                  이어 쓰기
                </Button>
              )}
              <Button variant="secondary" size="sm" {...otherModel}>
                다른 모델로
              </Button>
            </>
          }
        >
          {describeFailedReply(receipt.error)}
        </Failure>
      </>
    );
  } else if (opening && !version.text.trim()) {
    body = <Text variant="note">{`${NO_GREETING} 시작해요.`}</Text>;
  } else if (!empty || hosted.length > 0) {
    const box = ({ id, html }: Props['hosted'][number]) => <Story key={id} html={shownHtml(html, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} ref={actions.watch(id)} />;
    body = (
      <>
        {hosted.filter(({ at }) => at === 'top').map(box)}
        {/* A message may be all box: a status window's script took every word of it. */}
        {raw ? (
          <Story html={shownHtml(version.raw!, decor)} css={decor.css} buttons="inert" />
        ) : !empty && (
          <Story
            html={html}
            css={decor.css}
            buttons={decor.buttons}
            onPress={actions.press}
            term={term}
            tone={pending ? 'faded' : 'plain'}
            cursor={live || reveal.revealing || (translatingText !== null && !flipped)}
            illustrations={illustrations}
            inlays={part ? [{ mark: PART_MARK, node: <EditBox value={part.value} onChange={actions.changePart} onKeyDown={editKeys} /> }] : undefined}
            ref={story}
          />
        )}
        {hosted.filter(({ at }) => at === 'bottom').map(box)}
      </>
    );
  }

  // What the message translates is shown as it comes, so a flip to the original ends.
  const translateHere = () => {
    if (flipped) actions.flipTranslation(message);
    void actions.translate(message);
  };
  const again = { label: '다시 번역', disabled: translatingText !== null, onClick: translateHere };
  const translationMark =
    pending ? (
      <Marker reason="translation" label="번역 기다리는 중" />
    ) : untranslated ? (
      <Marker reason="translation" label={`번역하지 못했어요. ${describeTranslateFailure(untranslated)}`} action={canTranslate ? again : undefined} />
    ) : translatingText === null && !flipped && translation?.receipt?.state === 'cut' ? (
      <Marker reason="translation" label="번역 잘림" action={canTranslate ? again : undefined} />
    ) : translatingText === null && !sentTranslated && translationOutdated(version) ? (
      <Marker reason="translation" label="원문 수정됨" action={canTranslate ? again : undefined} />
    ) : null;
  const translateTool = translation ? (
    !both && <IconButton icon={Languages} size="xs" label={sentTranslated ? '보낸 메시지 보기' : '원문 보기'} pressed={flipped} onClick={() => actions.flipTranslation(message)} />
  ) : (
    canTranslate && !empty && !failed && <IconButton icon={Languages} size="xs" label="번역" disabled={translatingText !== null} onClick={translateHere} />
  );
  const translateAgain = canTranslate && translation && !sentTranslated && <MenuItem label="다시 번역" disabled={translatingText !== null} onClick={translateHere} />;
  // The language it went out in, not the setting now.
  const mark = !translation || editing !== null ? undefined : sentTranslated ? `${withParticle(languageLabel(translation.sentIn!), '으로/로')} 보냄` : flipped ? '원문' : '번역';

  const count = message.versions.length;
  // No call writes a greeting: its versions go round.
  const greeting = opening || version.greeting !== undefined;
  const nextLabel = message.selected === count - 1 && !greeting ? '다시 생성' : '다음';
  const [back, forward] = SHORTCUTS.swipe.keys;
  const after = (
    <>
      {selected && <SelectionButton icon={SquarePen} label="수정" at={selected.end} onPress={() => actions.edit(message, selected.part)} />}
      {editing === null && translationMark}
      {drawing?.writing && <Marker reason="illustration" label="장면 정하는 중" />}
      {polishing && <Marker reason="agent" label={POLISHING} />}
      {raw && <Marker reason="agent" label="다듬기 전 답" action={{ label: '다듬기 전으로 되돌리기', disabled: busy, onClick: () => actions.restoreRaw(message) }} />}
      {cut && (
        <Marker
          reason={MARK[cut]}
          label={cut === 'stopped' && empty ? '응답 전 중단됨' : CUT[cut]}
          action={
            !empty
              ? { label: '이어 쓰기', disabled: busy, onClick: () => actions.continue(message) }
              : cut === 'stopped'
                ? { label: ACTS.retry.label, disabled: busy, onClick: () => actions.retry(message) }
                : undefined
          }
        />
      )}
      {!mine && count > 1 && editing === null && (
        <Switcher
          count={`${message.selected + 1} / ${count}`}
          prev={{ label: '이전', title: titled('이전', [back]), disabled: busy, onClick: () => actions.swipe(message, -1) }}
          next={{ label: nextLabel, title: titled(nextLabel, [forward]), disabled: busy, onClick: () => actions.swipe(message, 1) }}
          pick={{ versions: message.versions.map((each) => firstLine(each.translation?.text ?? each.text) || NO_GREETING), selected: message.selected, disabled: busy, onPick: (index) => actions.pick(message, index) }}
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

  // A part edit offers no 저장하고 다시 생성: its ruling (design.md Part edit, 2026-10-16) is 취소 · 저장.
  const tools = live || message.unstored ? undefined : editing !== null ? (
    <>
      <Button variant="ghost" size="sm" onClick={actions.cancelEdit}>
        취소
      </Button>
      {replyNext && !part && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => actions.saveEdit(message, true)}>
          저장하고 다시 생성
        </Button>
      )}
      <Button size="sm" onClick={() => actions.saveEdit(message, false)}>
        저장
      </Button>
    </>
  ) : opening ? (
    <>
      {translateTool}
      {!empty && <IconButton icon={ACTS.copy.icon} size="xs" label={ACTS.copy.label} onClick={() => actions.copy(text)} />}
      {statusTool}
      {translateAgain && (
        <MoreMenu of="메시지" size="xs" place="end">
          {translateAgain}
        </MoreMenu>
      )}
    </>
  ) : (
    <>
      {remark && <Remark remark={remark} fresh={fresh} onSeen={() => actions.seeRemark(remark.id)} />}
      {!mine && !greeting && !failed && !busy && <IconButton icon={ACTS.regenerate.icon} size="xs" label={ACTS.regenerate.label} onClick={() => actions.regenerate(message)} />}
      {!mine && failed && !busy && <IconButton icon={ACTS.retry.icon} size="xs" label={ACTS.retry.label} onClick={() => actions.retry(message)} />}
      {translateTool}
      {!failed && <IconButton icon={SquarePen} size="xs" label="수정" onClick={() => actions.edit(message, selected?.part ?? null)} />}
      {!empty && <IconButton icon={ACTS.copy.icon} size="xs" label={ACTS.copy.label} onClick={() => actions.copy(text)} />}
      {bookmarked && <IconButton icon={Bookmark} size="xs" label={BOOKMARK} pressed onClick={() => actions.bookmark(message.id)} />}
      {!failed ? (
        <MoreMenu of="메시지" size="xs" place="end">
          {translateAgain}
          {canIllustrate && !mine && !empty && (
            <MenuItem label="삽화" disabled={running} onClick={() => actions.draw(message.id, version.id)} />
          )}
          <MenuItem label={BOOKMARK} checked={bookmarked} multiple onClick={() => actions.bookmark(message.id)} />
          <MenuItem label="여기서 분기" disabled={branching} onClick={() => void actions.branch(message)} />
          {hasRaw && <MenuItem label="다듬기 전 답 보기" checked={rawShown} multiple onClick={() => setRawShown(!rawShown)} />}
          {!mine && <MenuItem label="응답 정보" onClick={() => actions.info(message.id)} />}
          {offered.length > 0 && <MenuHeading>상태창으로 지정</MenuHeading>}
          {offered.map((script) => (
            <MenuItem key={script.id} label={script.name} checked={script.marked} multiple onClick={() => actions.markStatus(script, !script.marked)} />
          ))}
          {toolActions.map((tool) => [
            <MenuHeading key={tool.module}>{tool.name}</MenuHeading>,
            ...tool.items.map((item) => <MenuItem key={`${tool.module}:${item.id}`} label={item.label} onClick={() => actions.toolAction(tool.module, item.id, message.id)} />),
          ])}
        </MoreMenu>
      ) : (
        !mine && <IconButton icon={Info} size="xs" label="응답 정보" onClick={() => actions.info(message.id)} />
      )}
      <Divider variant="tools" />
      {last ? (
        <IconButton icon={ACTS.remove.icon} size="xs" label={ACTS.remove.label} onClick={() => actions.remove(message)} />
      ) : (
        <Menu place="end" label="메시지 삭제" trigger={(opener) => <IconButton icon={ACTS.remove.icon} size="xs" label={ACTS.remove.label} {...opener} />}>
          <MenuItem label="이 메시지만 삭제" tone="warn" onClick={() => actions.remove(message)} />
          <MenuItem label="여기부터 끝까지 삭제" tone="warn" onClick={() => actions.removeFrom(message)} />
        </Menu>
      )}
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
      id={message.id}
      found={found}
      marked={marked}
      writing={live || reveal.revealing}
    >
      {body}
    </StoryMessage>
  );
}, sameRow);

function Remark({ remark, fresh, onSeen }: { remark: Stored<'remark'>; fresh: boolean; onSeen: () => void }) {
  const { mascot, expression, line } = remark.value;
  const pictures = MASCOT_PICTURES[mascot];
  return <MascotRemark face={pictures.face} picture={pictures.expressions[expression]} name={MASCOTS[mascot].name} line={line} fresh={fresh} onSeen={onSeen} />;
}

// It counts from when this page began to wait.
function Elapsed({ thinking }: { thinking: boolean }) {
  const [start] = useState(Date.now);
  const now = useNow(Infinity);
  const seconds = Math.floor((now - start) / 1000);
  return <Waiting note={`${thinking ? '추론 중' : '기다리는 중'} · ${seconds}초`} />;
}

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

export const speaker = (message: Message, character: { name: string } | null, me: { name: string } | null, modelName: string | null) =>
  message.role === 'user' ? (me?.name ?? NO_PERSONA) : (character?.name ?? shown(message).receipt?.modelName ?? modelName ?? '모델');

// Without the bot's style, only the chat's own pictures show: its inlays, whose markup alone the plain display keeps.
export const shownHtml = (text: string, { bot, url }: Pick<Props['decor'], 'bot' | 'url'>) => resolveAssets(storyHtml(text, bot), bot ? url : (kind, id) => (kind === 'inlay' ? url(kind, id) : undefined));
