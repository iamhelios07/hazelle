import { scriptVoice } from '../common/script-voice';
import { useScripts, useSession } from '../session';
import { AskCard } from '../ui';
import { asking } from './ask';
import type { OpenChat } from './useChat';

// What the bot's script asks, one question at a time, the oldest first: a card by the composer and never a dialog, so
// the chat stays in use around it (design §6.8). onTyped: a typed answer was given, which had taken the focus.
export function ChatAsk({ chat, onTyped }: { chat: OpenChat; onTyped: () => void }) {
  const { scripts, store } = useSession();
  const asked = useScripts().questions.find((question) => question.chat === chat.id);
  if (!asked) return null;
  const from = scriptVoice(store, asked.from);
  if (!from) return null;
  return (
    <AskCard
      key={asked.id}
      from={from}
      {...asking(asked.question, asked.from.kind)}
      onAnswer={(answer) => {
        scripts.answer(asked.id, answer);
        if (asked.question.kind === 'input') onTyped();
      }}
    />
  );
}
