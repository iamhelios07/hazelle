import type { Prompt, TextBlock } from '../model/prompt';
import { unescapeCbs } from './cbs/escape';
import { evaluate, type CbsContext } from './cbs/evaluate';
import type { HistoryMessage } from './history';
import type { Card } from './import/types';
import type { LoreInput } from './lorebook/activate';
import { applyScripts } from './regex/scripts';

export type Stage = 'display' | 'prompt';

// What a chat's text is rendered with (runtime/turn gathers it).
export type ChatScope = {
  card: Card | null;
  // Each null when the chat's is gone: the display still renders, and a turn stops before sending.
  persona: CbsContext['persona'];
  prompt: Prompt | null;
  // The chat's own 작가의 노트; null follows the prompt's (design §4.2).
  note: string | null;
  lore: LoreInput['entries'];
  // Oldest first, each as its shown version.
  messages: HistoryMessage[];
  greeting: CbsContext['greeting'];
  toggle: CbsContext['toggle'];
  model: CbsContext['model'];
  clock: CbsContext['clock'];
  // The character and the chat, which pick and rollp seed with a message count (engine/cbs).
  pick: string;
};

export const authorNote = (note: string | null, prompt: Prompt) => note ?? prompt.authorNote;
const marked = (prompt: Prompt, mark: 'main' | 'globalNote') => prompt.blocks.find((block): block is TextBlock => block.kind === 'text' && block.mark === mark)?.text ?? '';

// One chat's CBS contexts for a stage, by the text's source and the variables it reads.
export function contexts(scope: ChatScope, stage: Stage): (source: CbsContext['source'], variables: Map<string, string>) => CbsContext {
  const { card, persona, prompt, note, messages, greeting, toggle, model, clock, pick } = scope;
  const fixed = {
    stage,
    card,
    persona,
    prompt: prompt && { main: marked(prompt, 'main'), globalNote: marked(prompt, 'globalNote'), authorNote: authorNote(note, prompt) },
    lore: scope.lore.map(({ value }) => value),
    messages,
    greeting,
    toggle,
    model,
    screen: null,
    clock,
  };
  return (source, variables) => ({ ...fixed, source, variables, pickSeed: `${pick}:${'message' in source ? source.message : messages.length}` });
}

// The one pass that turns a chat's stored text into the text shown or sent (design §5 rows 11, 17 and 19),
// oldest message first. The input or output stage runs on the stored text over the chat's variables, and its
// CBS is where the message's setvar, addvar and setdefaultvar write: one writing pass per message, so a stage
// chained after it cannot run one twice. The process or display stage then reads a copy of the variables as the
// message left them, so the display never changes what the prompt sees.
export function renderChat(stage: Stage, scope: ChatScope): { texts: string[]; variables: Map<string, string> } {
  const context = contexts(scope, stage);
  const scripts = scope.card?.regex ?? [];
  const variables = new Map(scope.card?.variables);
  const texts = scope.messages.map(({ role, text }, index) => {
    const cbs = (read: Map<string, string>) => (part: string) => evaluate(part, context({ message: index }, read));
    const at = { messages: scope.messages, index };
    // Neither the user nor the model wrote the greeting, so it skips their stages; its CBS still writes (row 18).
    const written = index === 0 && scope.greeting !== null ? [] : scripts;
    const replayed = applyScripts(role === 'user' ? 'input' : 'output', text, { ...at, scripts: written, cbs: cbs(variables) }).text;
    return unescapeCbs(applyScripts(stage === 'prompt' ? 'process' : 'display', replayed, { ...at, scripts, cbs: cbs(new Map(variables)) }).text);
  });
  return { texts, variables };
}
