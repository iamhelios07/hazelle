import { useEffect } from 'react';
import { toolId } from '../../model/tool';
import { scriptVoice } from '../common/script-voice';
import { useScripts, useSession } from '../session';
import { AskCard } from '../ui';
import { asking } from './ask';

// What the bot's script asks, one question at a time, the oldest first: a card by the composer and never a dialog, so
// the chat stays in use around it (design §6.8). onTyped: a typed answer was given, which had taken the focus.
export function ChatAsk({ id, onTyped }: { id: string | null; onTyped: () => void }) {
  const { scripts, store } = useSession();
  const asked = useScripts().questions.find((question) => question.chat === id);
  const from = asked && scriptVoice(store, asked.from);
  const orphan = asked && !from ? asked.id : null;
  // Its asker was deleted while it asked. Dismissed, not just hidden: a hidden one would hold back the questions after it.
  useEffect(() => {
    if (orphan !== null) scripts.answer(orphan, null);
  }, [orphan]);
  if (!asked || !from) return null;
  const owner = asked.from.kind === 'module' && store.get('tool', toolId(asked.from.id)) ? 'plugin' : asked.from.kind;
  return (
    <AskCard
      key={asked.id}
      from={from}
      {...asking(asked.question, owner)}
      onAnswer={(answer) => {
        scripts.answer(asked.id, answer);
        if (asked.question.kind === 'input') onTyped();
      }}
    />
  );
}
