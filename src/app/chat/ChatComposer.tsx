import { useRef, useState, type KeyboardEvent } from 'react';
import { shown } from '../../model/chat';
import { hints, SHORTCUTS, titled } from '../shortcuts';
import { Button, Callout, Composer, pressed, pressedKey, SendButton, useWide } from '../ui';
import type { OpenChat } from './useChat';

export function ChatComposer({ chat }: { chat: OpenChat }) {
  const { draft, messages, last, busy, streaming, problem, actions } = chat;
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
        actions.edit(mine, shown(mine).text);
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
      {problem && <Callout tone="warn">{problem}</Callout>}
      <Composer
        inputRef={input}
        value={draft.text}
        onChange={draft.set}
        onKeyDown={onKey}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="메시지 · *행동*은 별표로 감싸요"
        hint={hint}
        actions={
          <>
            {!busy && !draft.text.trim() && last?.role === 'user' && (
              <Button variant="ghost" size="sm" onClick={actions.answer}>
                답장 받기
              </Button>
            )}
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
