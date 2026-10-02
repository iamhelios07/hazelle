import { aliased } from '../common/alias';
import { MODULE_VOICE } from '../common/words';
import { useScripts, useSession } from '../session';
import { AskCard } from '../ui';
import { asking } from './ask';
import type { OpenChat } from './useChat';

// What the bot's script asks, one question at a time, the oldest first: a card by the composer and never a dialog, so
// the chat stays in use around it (design §6.8). onTyped: a typed answer was given, which had taken the focus.
export function ChatAsk({ chat, onTyped }: { chat: OpenChat; onTyped: () => void }) {
  const { scripts } = useSession();
  const asked = useScripts().questions.find((question) => question.chat === chat.id);
  if (!asked) return null;
  // A chat with no character has only its modules' scripts to ask.
  const from = chat.shelf ? { name: aliased(chat.shelf.character.card.name, chat.shelf.character.alias), face: chat.shelf.face } : MODULE_VOICE;
  return (
    <AskCard
      key={asked.id}
      from={from}
      {...asking(asked.question)}
      onAnswer={(answer) => {
        scripts.answer(asked.id, answer);
        if (asked.question.kind === 'input') onTyped();
      }}
    />
  );
}
