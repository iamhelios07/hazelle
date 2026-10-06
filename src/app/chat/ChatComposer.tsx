import { useRef, type KeyboardEvent } from 'react';
import type { Blocked } from '../../runtime/turn';
import { describeTurnFailure } from '../common/failure';
import { withRo } from '../common/languages';
import { SHORTCUTS, titled } from '../shortcuts';
import { Button, Callout, Composer, pressed, pressedKey, SendButton, SendNote, useMenuOpener } from '../ui';
import { ChatAsk } from './ChatAsk';
import { ChatCache } from './ChatCache';
import { ChatNote } from './ChatNote';
import { ChatPersonaPicker } from './ChatPersonaPicker';
import { ChatTranslate } from './ChatTranslate';
import type { OpenChat } from './useChat';

const LEAVING = '가장 오래된 메시지가 이번 요청에서 빠지는데, 장기 기억이 아직 정리하지 못했거나 보내지 않는 부분이라 모델이 그 내용을 몰라요. 장기 기억 패널에서 무엇이 빠지는지 볼 수 있어요.';

type Chip = 'model' | 'prompt' | 'persona';
const FIX = {
  'no-model': { label: '모델 고르기', chip: 'model' },
  'model-gone': { label: '모델 고르기', chip: 'model' },
  'prompt-missing': { label: '프롬프트 고르기', chip: 'prompt' },
  'persona-missing': { label: '페르소나 고르기', chip: 'persona' },
  'profile-missing': { label: '모델 설정 고르기', chip: 'model' },
} as const satisfies Record<Blocked['kind'], { label: string; chip: Chip }>;

// folded: ChatScreen's, which the frame's footer measures by, so the two never disagree.
export function ChatComposer({ chat, folded }: { chat: OpenChat; folded: boolean }) {
  const { draft, messages, last, busy, problem, translate, sendLanguage, modelMenu, promptMenu, actions } = chat;
  const chips: Record<Chip, { onClick: () => void }> = { model: useMenuOpener(modelMenu), prompt: useMenuOpener(promptMenu), persona: { onClick: () => actions.openDialog('persona') } };
  const input = useRef<HTMLTextAreaElement>(null);

  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pressed(event, SHORTCUTS.send.keys)) {
      event.preventDefault();
      void actions.send();
      return;
    }
    if (busy && pressed(event, SHORTCUTS.stop.keys)) {
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
        compact={folded}
        value={draft.text}
        onChange={draft.set}
        onKeyDown={onKey}
        placeholder={translate.input ? `${withRo(sendLanguage)} 옮겨 보내요` : '메시지'}
        tools={
          <>
            <ChatPersonaPicker chat={chat} />
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
              streaming={busy}
              disabled={!busy && !draft.text.trim()}
              title={busy ? titled(SHORTCUTS.stop.label, SHORTCUTS.stop.keys) : titled(SHORTCUTS.send.label, SHORTCUTS.send.keys)}
              onClick={() => (busy ? actions.stop() : void actions.send())}
            />
          </>
        }
      />
    </>
  );
}
