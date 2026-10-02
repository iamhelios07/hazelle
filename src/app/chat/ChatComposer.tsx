import { useRef, useState, type KeyboardEvent } from 'react';
import type { Blocked } from '../../runtime/turn';
import { describeTurnFailure } from '../common/failure';
import { withRo } from '../common/languages';
import { hints, SHORTCUTS, titled } from '../shortcuts';
import { Button, Callout, Composer, pressed, pressedKey, SendButton, SendNote, useMenuOpener, useWide } from '../ui';
import { ChatAsk } from './ChatAsk';
import { ChatCache } from './ChatCache';
import { ChatNote } from './ChatNote';
import { ChatPersonaMenu } from './ChatPersonaMenu';
import { ChatTranslate } from './ChatTranslate';
import type { OpenChat } from './useChat';

const LEAVING = '가장 오래된 메시지가 이번 요청에서 빠지는데, 장기 기억이 아직 정리하지 못했거나 보내지 않는 부분이라 모델이 그 내용을 몰라요. 장기 기억 패널에서 무엇이 빠지는지 볼 수 있어요.';

type Chip = 'model' | 'prompt' | 'persona';
// The chip whose menu fixes each failure that stops a chat before sending.
const FIX = {
  'no-model': { label: '모델 고르기', chip: 'model' },
  'model-gone': { label: '모델 고르기', chip: 'model' },
  'prompt-missing': { label: '프롬프트 고르기', chip: 'prompt' },
  'persona-missing': { label: '페르소나 고르기', chip: 'persona' },
  'profile-missing': { label: '모델 설정 고르기', chip: 'model' },
} as const satisfies Record<Blocked['kind'], { label: string; chip: Chip }>;

export function ChatComposer({ chat }: { chat: OpenChat }) {
  const { draft, messages, last, busy, streaming, problem, translate, sendLanguage, modelMenu, promptMenu, personaMenu, scroll, actions } = chat;
  const chips: Record<Chip, { onClick: () => void }> = { model: useMenuOpener(modelMenu), prompt: useMenuOpener(promptMenu), persona: useMenuOpener(personaMenu) };
  const wide = useWide();
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pressed(event, SHORTCUTS.send.keys)) {
      event.preventDefault();
      void actions.send();
      return;
    }
    if (streaming && pressed(event, SHORTCUTS.stop.keys)) {
      event.preventDefault();
      actions.stop();
      return;
    }
    if (draft.text !== '' || busy) return;
    const step = pressedKey(event, SHORTCUTS.swipe.keys);
    if (pressed(event, SHORTCUTS.editLast.keys)) {
      const mine = messages.findLast((message) => message.role === 'user');
      if (mine) {
        event.preventDefault();
        actions.edit(mine);
      }
    } else if (step !== -1 && last?.role === 'assistant') {
      event.preventDefault();
      actions.swipe(last, step === 0 ? -1 : 1);
    }
  }

  // Key hints only where there is a keyboard to press them.
  const hint = !focused || !wide ? '' : streaming ? hints(SHORTCUTS.stop) : draft.text ? hints(SHORTCUTS.send, SHORTCUTS.newline) : hints(SHORTCUTS.send, SHORTCUTS.editLast, SHORTCUTS.swipe);

  return (
    <>
      {problem && (
        <Callout tone="warn" action={{ label: FIX[problem.kind].label, onClick: chips[FIX[problem.kind].chip].onClick }}>
          {describeTurnFailure(problem)}
        </Callout>
      )}
      <ChatAsk chat={chat} onTyped={() => input.current?.focus()} />
      <Composer
        inputRef={input}
        compact={scroll.away}
        value={draft.text}
        onChange={draft.set}
        onKeyDown={onKey}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={translate.input ? `${withRo(sendLanguage)} 옮겨 보내요` : '메시지'}
        hint={hint}
        tools={
          <>
            <ChatPersonaMenu chat={chat} />
            <ChatNote chat={chat} />
            <ChatTranslate chat={chat} />
          </>
        }
        actions={
          <>
            {!busy && !draft.text.trim() && last?.role === 'user' && (
              <Button variant="ghost" size="sm" onClick={actions.answer}>
                답장 받기
              </Button>
            )}
            {!busy && chat.leaving ? <SendNote label={`메시지 ${chat.leaving}개`} title="기억 없이 빠질 메시지" warning={{ words: '기억 없이 빠짐', why: LEAVING }} /> : null}
            {!busy && <ChatCache cache={chat.cache} />}
            <SendButton
              streaming={streaming}
              disabled={!streaming && (!draft.text.trim() || busy)}
              title={streaming ? titled(SHORTCUTS.stop.hint, SHORTCUTS.stop.keys) : busy ? '다른 채팅에서 답장을 받는 중이에요' : titled(SHORTCUTS.send.hint, SHORTCUTS.send.keys)}
              onClick={() => (streaming ? actions.stop() : void actions.send())}
            />
          </>
        }
      />
    </>
  );
}
