import { Bot, Copy, GitBranch, Info, Languages, Pencil, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import { memo, useMemo, type KeyboardEvent } from 'react';
import { resolveAssets } from '../../engine/assets';
import { storyHtml } from '../../engine/display';
import type { Box } from '../../engine/regex/scripts';
import { firstLine, shown } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import type { Translating } from '../../runtime/translate';
import { describeReplyError, describeTranslateFailure } from '../common/failure';
import { languageLabel, withRo } from '../common/languages';
import { timeOfDay } from '../common/time';
import { hints, SHORTCUTS, titled } from '../shortcuts';
import { Avatar, Button, Divider, EditBox, Failure, IconButton, Marker, Menu, MenuHeading, MenuItem, pressed, Story, StoryMessage, Switcher, Text, useMenuOpener, Waiting, type MenuHandle } from '../ui';
import type { ChatActions } from './useChat';
import { useReveal } from './useReveal';

type Props = {
  message: Shown;
  // Editing starts from the stored text.
  text: string;
  decor: { bot: boolean; css: string; url: (id: string) => string | undefined; buttons: 'live' | 'inert' };
  hosted: Box[];
  offered: { script: number; name: string; marked: boolean }[];
  translating: Translating;
  awaited: boolean;
  flipped: boolean;
  isLast: boolean;
  beforeLastReply: boolean;
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
  branching: boolean;
  modelMenu: MenuHandle;
  infoDrawer: string;
  actions: ChatActions;
};

// A card's blank greeting, which starts the chat with no first message.
const NO_GREETING = '첫 메시지 없이';

const NO_PERSONA = '페르소나 없음';

const CUT = { length: '여기서 잘렸어요', 'no-terminal': '여기서 끊겼어요', stopped: '여기서 멈췄어요' } as const;

export const ChatMessage = memo(function ChatMessage(props: Props) {
  const { message, text: original, decor, hosted, offered, translating, awaited, flipped, isLast, beforeLastReply, character, me, modelName, opening, busy, editing, pinned, found, branching, modelMenu, infoDrawer, actions } = props;
  const otherModel = useMenuOpener(modelMenu);
  const version = shown(message);
  const receipt = version.receipt;
  const mine = message.role === 'user';
  const live = message.live === version.id;
  const translation = version.translation ?? null;
  const translatingText = translating.live.get(version.id) ?? null;
  const untranslated = translating.failed.get(version.id) ?? null;
  const text = flipped ? original : translatingText || (translation?.text ?? original);
  const pending = !translatingText && (awaited || translatingText === '');
  const reveal = useReveal(version.id, text, live && !message.whole);
  const html = useMemo(() => shownHtml(reveal.text, decor), [reveal.text, decor.bot, decor.url]);
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
      void actions.saveEdit(message, false);
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
              ? { firstLabel: '모델에게 보낸 말', label: '내가 쓴 말', value: editing.translation, onChange: (translation) => actions.changeEdit({ translation }) }
              : { firstLabel: '원문', label: '번역', value: editing.translation, onChange: (translation) => actions.changeEdit({ translation }) }
        }
        onKeyDown={editKeys}
        hint={hints(SHORTCUTS.cancelEdit, SHORTCUTS.saveEdit)}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={actions.cancelEdit}>
              취소
            </Button>
            {beforeLastReply && (
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void actions.saveEdit(message, true)}>
                저장하고 새 답장 받기
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
        {receipt.continues && <Story html={shownHtml(original, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} />}
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
  } else if (opening && !version.text.trim()) {
    body = <Text variant="note">{`${NO_GREETING} 시작해요.`}</Text>;
  } else if (!empty || hosted.length > 0) {
    const box = ({ script, html }: Box) => (
      <div key={script} ref={actions.watch(script)}>
        <Story html={shownHtml(html, decor)} css={decor.css} buttons={decor.buttons} onPress={actions.press} />
      </div>
    );
    body = (
      <>
        {hosted.filter(({ at }) => at === 'top').map(box)}
        {/* A message may be all box: a status window's script took every word of it. */}
        {!empty && <Story html={html} css={decor.css} buttons={decor.buttons} onPress={actions.press} tone={pending ? 'faded' : 'plain'} cursor={live || reveal.revealing || (translatingText !== null && !flipped)} />}
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
      <Marker reason="translation" label="번역이 여기서 잘렸어요" action={again} />
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
        ? { label: translation.sentIn ? `${withRo(languageLabel(translation.sentIn))} 보냄` : '옮겨 보냄', action: flipped ? '내가 쓴 말 보기' : '보낸 말 보기', onClick: flip }
        : { label: flipped ? '원문' : '번역', action: flipped ? '번역 보기' : '원문 보기', onClick: flip };

  const count = message.versions.length;
  const nextLabel = message.selected === count - 1 && !opening ? '새 답장 받기' : '다음';
  const [back, forward] = SHORTCUTS.swipe.keys;
  const after = (
    <>
      {editing === null && translationMark}
      {cut && (
        <Marker
          reason={cut === 'stopped' ? 'stopped' : 'length'}
          label={cut === 'stopped' && empty ? '답장을 받기 전에 멈췄어요' : CUT[cut]}
          action={
            !empty
              ? { label: '이어 쓰기', disabled: busy, onClick: () => actions.continue(message) }
              : cut === 'stopped'
                ? { label: '다시 시도', disabled: busy, onClick: () => actions.retry(message) }
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
        onClick={() => actions.markStatus(only!.script, !only!.marked)}
      />
    ) : offered.length > 1 ? (
      <Menu place="below-end" label="상태창으로 지정" trigger={(opener) => <IconButton icon={Pin} size="xs" label="상태창으로 지정" {...opener} />}>
        <MenuHeading>상태창으로 지정할 상자</MenuHeading>
        {offered.map(({ script, name, marked }) => (
          <MenuItem key={script} label={name} checked={marked} onClick={() => actions.markStatus(script, !marked)} />
        ))}
      </Menu>
    ) : null;

  const tools = live || message.unstored || editing !== null ? undefined : opening ? (
    <>
      {translateTool}
      {!empty && <IconButton icon={Copy} size="xs" label="복사" onClick={() => actions.copy(text)} />}
      {statusTool}
    </>
  ) : (
    <>
      {!mine && isLast && !failed && !busy && <IconButton icon={RotateCcw} size="xs" label="새 답장 받기" onClick={() => actions.regenerate(message)} />}
      {!mine && failed && !busy && <IconButton icon={RotateCcw} size="xs" label="다시 시도" onClick={() => actions.retry(message)} />}
      {translateTool}
      {!failed && <IconButton icon={Pencil} size="xs" label="수정" onClick={() => actions.edit(message)} />}
      {!empty && <IconButton icon={Copy} size="xs" label="복사" onClick={() => actions.copy(text)} />}
      {!failed && <IconButton icon={GitBranch} size="xs" label="여기서 갈라지기" disabled={branching} onClick={() => void actions.branch(message)} />}
      {!mine && <IconButton icon={Info} size="xs" label="답장 정보" controls={infoDrawer} onClick={() => actions.info(message.id)} />}
      {statusTool}
      <Divider variant="tools" />
      <IconButton icon={Trash2} size="xs" label="지우기 · 되돌릴 수 있어요" onClick={() => void actions.remove(message)} />
    </>
  );

  return (
    <StoryMessage
      avatar={mine ? <Avatar face={me?.name ?? '?'} image={me?.image} tone="you" /> : character ? <Avatar face={character.name} image={character.image} /> : <Avatar face={Bot} />}
      name={mine ? (me?.name ?? NO_PERSONA) : (character?.name ?? receipt?.modelName ?? modelName ?? '모델')}
      time={timeOfDay(version.at)}
      mine={mine && editing === null}
      mark={mark}
      after={after}
      tools={tools}
      pinned={pinned}
      found={found}
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
  if (aHosted.length !== bHosted.length || aHosted.some((box, index) => box.script !== bHosted[index]!.script || box.html !== bHosted[index]!.html || box.at !== bHosted[index]!.at)) return false;
  if (aOffered.length !== bOffered.length || aOffered.some((box, index) => box.script !== bOffered[index]!.script || box.name !== bOffered[index]!.name || box.marked !== bOffered[index]!.marked)) return false;
  const id = shown(next.message).id;
  return aTranslating.live.get(id) === bTranslating.live.get(id) && aTranslating.failed.get(id) === bTranslating.failed.get(id);
}

export const shownHtml = (text: string, { bot, url }: Props['decor']) => (bot ? resolveAssets(storyHtml(text, true), url) : storyHtml(text, false));
