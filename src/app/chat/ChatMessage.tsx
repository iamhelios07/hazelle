import { Bot, Copy, GitBranch, Info, Languages, Pencil, Pin, PinOff, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, type KeyboardEvent } from 'react';
import { resolveAssets } from '../../engine/assets';
import { storyHtml } from '../../engine/display';
import type { Box } from '../../engine/regex/scripts';
import { shown } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import type { Translating } from '../../runtime/translate';
import { describeReplyError, describeTranslateFailure } from '../common/failure';
import { withRo } from '../common/languages';
import { timeOfDay } from '../common/time';
import { useSession } from '../session';
import { hints, SHORTCUTS, titled } from '../shortcuts';
import { Avatar, Button, Divider, EditBox, Failure, IconButton, Marker, Menu, MenuHeading, MenuItem, pressed, Story, StoryMessage, Switcher, useMenuOpener, Waiting, type MenuHandle } from '../ui';
import type { ChatActions } from './useChat';
import { useReveal } from './useReveal';

type Props = {
  message: Shown;
  // The shown version's text as it is displayed. Editing starts from the stored text.
  text: string;
  // 봇 꾸밈: whether the bot's HTML is drawn, its CSS for the chat, and its pictures' URLs.
  decor: { bot: boolean; css: string; url: (id: string) => string | undefined };
  // The status window's boxes this message draws, being the latest to draw them, at the end each stood at.
  hosted: Box[];
  // The boxes the bot drew in this message, by the script that draws each, and whether it is the status window's.
  offered: { script: number; name: string; marked: boolean }[];
  // The chat's translations being made, failed, or held for a chat not saved yet, and whether this version shows the
  // other way round from its default.
  translating: Translating;
  // 답장 번역 will translate this version, being written or just written.
  awaited: boolean;
  // The label of the language a message is sent translated in.
  sendLanguage: string;
  flipped: boolean;
  isLast: boolean;
  // The user's message right before the last reply, which 저장하고 새 답장 받기 answers again.
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
  // What the edit box holds, while this message is being edited: its text, and its translation when it has one.
  editing: { text: string; translation: string | null } | null;
  pinned: boolean;
  // A branch of this chat is being saved; one at a time.
  branching: boolean;
  // The header's model menu, which a failed reply's 다른 모델로 opens.
  modelMenu: MenuHandle;
  actions: ChatActions;
};

const CUT = { length: '여기서 잘렸어요', 'no-terminal': '여기서 끊겼어요', stopped: '여기서 멈췄어요' } as const;

export function ChatMessage(props: Props) {
  const { message, text: original, decor, hosted, offered, translating, awaited, sendLanguage, flipped, isLast, beforeLastReply, character, modelName, opening, busy, editing, pinned, branching, modelMenu, actions } = props;
  const { username } = useSession();
  const otherModel = useMenuOpener(modelMenu);
  const version = shown(message);
  const receipt = version.receipt;
  const mine = message.role === 'user';
  const live = message.live === version.id;
  // A version with a translation shows it, and a translation being made shows as it comes.
  const translation = version.translation ?? translating.held.get(version.id) ?? null;
  const translatingText = translating.live.get(version.id) ?? null;
  const untranslated = translating.failed.get(version.id) ?? null;
  const text = flipped ? original : translatingText || (translation?.text ?? original);
  // What shows until a translation's first text comes stays faded, and the translation then streams in its place.
  const pending = !translatingText && (awaited || translatingText === '');
  const reveal = useReveal(version.id, text, live);
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
        {receipt.continues && <Story html={shownHtml(original, decor)} css={decor.css} onInert={actions.inert} />}
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
    const box = ({ script, html }: Box) => (
      <div key={script} ref={actions.watch(script)}>
        <Story html={shownHtml(html, decor)} css={decor.css} onInert={actions.inert} />
      </div>
    );
    body = (
      <>
        {hosted.filter(({ at }) => at === 'top').map(box)}
        <Story html={html} css={decor.css} onInert={actions.inert} tone={pending ? 'faded' : 'plain'} cursor={live || reveal.revealing || (translatingText !== null && !flipped)} />
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
  const mark =
    !translation || editing !== null
      ? undefined
      : mine
        ? { label: `${withRo(sendLanguage)} 보냄`, action: flipped ? '내가 쓴 말 보기' : '보낸 말 보기', onClick: flip }
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

  const tools = live || editing !== null ? undefined : opening ? (
    <>
      {translateTool}
      <IconButton icon={Copy} size="xs" label="복사" onClick={() => actions.copy(text)} />
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
      {!mine && <IconButton icon={Info} size="xs" label="답장 정보" onClick={() => actions.info(message.id)} />}
      {statusTool}
      <Divider variant="tools" />
      <IconButton icon={Trash2} size="xs" label="지우기 · 되돌릴 수 있어요" onClick={() => void actions.remove(message)} />
    </>
  );

  return (
    <StoryMessage
      avatar={mine ? <Avatar face={username} tone="you" /> : character ? <Avatar face={character.name} image={character.image} /> : <Avatar face={Bot} />}
      name={mine ? username : (character?.name ?? receipt?.modelName ?? modelName ?? '모델')}
      time={timeOfDay(version.at)}
      mine={mine && editing === null}
      mark={mark}
      after={after}
      tools={tools}
      pinned={pinned}
      onTap={() => actions.pin(message)}
    >
      {body}
    </StoryMessage>
  );
}

// A shown text as the story draws it, in a message or in 상태.
export const shownHtml = (text: string, { bot, url }: Props['decor']) => (bot ? resolveAssets(storyHtml(text, true), url) : storyHtml(text, false));
