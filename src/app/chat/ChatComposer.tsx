import { useRef, type KeyboardEvent } from 'react';
import type { Blocked } from '../../runtime/turn-context';
import { describeTurnFailure } from '../common/failure';
import { withParticle } from '../common/particles';
import { SHORTCUTS, titled } from '../shortcuts';
import { Button, Callout, Composer, Hint, pressed, pressedKey, SendButton, SendNote, useMenuOpener } from '../ui';
import { ChatAsk } from './ChatAsk';
import { ChatCache } from './ChatCache';
import { ChatComposerTools } from './ChatComposerTools';
import { ChatIllustrate } from './ChatIllustrate';
import { ChatNote } from './ChatNote';
import { ChatPinnedToggles } from './ChatPinnedToggles';
import { ChatPersonaPicker } from './ChatPersonaPicker';
import { ChatTranslate } from './ChatTranslate';
import type { OpenChat } from './useChat';

const LEAVING = '가장 오래된 메시지가 요청에서 빠지는데, 장기 기억에도 없어서 모델이 그 내용을 알 수 없어요.';

type Chip = 'model' | 'prompt' | 'persona';
const FIX = {
  'no-model': { label: '모델 선택', chip: 'model' },
  'model-gone': { label: '모델 선택', chip: 'model' },
  'image-only': { label: '모델 선택', chip: 'model' },
  'prompt-missing': { label: '프롬프트 선택', chip: 'prompt' },
  'persona-missing': { label: '페르소나 선택', chip: 'persona' },
  'profile-missing': { label: '모델 설정 선택', chip: 'model' },
} as const satisfies Record<Blocked['kind'], { label: string; chip: Chip }>;

// folded: ChatScreen's, which the frame's footer measures by, so the two never disagree.
export function ChatComposer({ chat, folded }: { chat: OpenChat; folded: boolean }) {
  const { draft, messages, last, busy, problem, stuck, translate, sendLanguage, modelMenu, shelf, actions } = chat;
  const chips: Record<Chip, { onClick: () => void }> = { model: useMenuOpener(modelMenu), prompt: { onClick: () => actions.openDialog('prompt') }, persona: { onClick: () => actions.openDialog('persona') } };
  const input = useRef<HTMLTextAreaElement>(null);
  const editPrompt = (id: string | null) => actions.side({ kind: 'prompts', id, pane: null });

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
        actions.edit(mine, null);
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
      {stuck && (
        <Callout tone="warn" action={{ label: '다시 시도', onClick: actions.retryRegex }}>
          봇 스크립트가 끝나지 않아서 정규식을 껐어요.
          <Hint label="정규식 꺼짐">캐릭터나 모듈의 정규식, 또는 로어북 키워드 중 하나가 원인이에요. 다른 기기에서도 함께 꺼져요.</Hint>
        </Callout>
      )}
      <ChatAsk id={chat.id} onTyped={() => input.current?.focus()} />
      <Composer
        inputRef={input}
        compact={folded}
        value={draft.text}
        onChange={draft.set}
        onKeyDown={onKey}
        placeholder={translate.input ? `${withParticle(sendLanguage, '으로/로')} 번역해서 보내요` : '메시지'}
        tools={
          <>
            <ChatPersonaPicker persona={chat.persona} open={chat.dialog === 'persona'} onOpen={() => actions.openDialog('persona')} />
            <ChatNote id={chat.id} note={chat.note} prompt={chat.prompt} onSave={actions.setNote} />
            {chat.features.translate && <ChatTranslate
              translate={translate}
              translation={chat.translation}
              card={chat.card}
              note={shelf?.character.translatorNote}
              onChange={actions.setTranslate}
              onOwnChange={actions.setOwnTranslate}
              onEditPrompt={editPrompt}
              onEditCharacter={shelf ? () => actions.side({ kind: 'character', id: shelf.id, part: 'instructions' }) : undefined}
            />}
            {chat.features.illustrate && <ChatIllustrate illustrate={chat.illustrate} card={chat.card} onChange={actions.setIllustrate} onOwnChange={actions.setOwnIllustrate} onEditPrompt={editPrompt} />}
            <ChatComposerTools tools={chat.composerTools} onOpen={actions.tool} />
            <ChatPinnedToggles toggles={chat.toggles} onFlip={actions.flip} />
          </>
        }
        actions={
          <>
            {!busy && !draft.text.trim() && last?.role === 'user' && (
              <Button variant="ghost" size="sm" onClick={actions.answer}>
                응답 받기
              </Button>
            )}
            {!busy && chat.sendNotes.leaving ? <SendNote label={`메시지 ${chat.sendNotes.leaving}개`} title="요청에서 빠질 메시지" warning={{ words: '기억에 없음', why: LEAVING }} /> : null}
            {!busy && <ChatCache cache={chat.sendNotes.cache} onOpen={() => chat.actions.openInspect('cache')} />}
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
