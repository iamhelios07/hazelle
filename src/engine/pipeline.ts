import type { ChatMessage } from '../connectors/types';
import type { Card } from './import/types';
import { CBS_TAG, FILLED, render, type Scope } from './render';

// The first-cut card prompt. The prompt template (design §5) replaces all of this, and with it this
// stand-in for the template's main text, which a card's system_prompt reaches as {{original}}.
const MAIN = "Write {{char}}'s next reply in this fictional roleplay with {{user}}. Stay in character, and never write {{user}}'s words or actions.";

// What one reply's prompt is built from (runtime/turn gathers it): who the chat's text names, and the
// messages the reply follows, each as the stored text of its shown version.
export type PromptInput = { scope: Scope; history: { role: 'user' | 'assistant'; text: string }[] };

// The card, the chat, then the card's post-history instructions, every text rendered for the prompt
// (engine/render). A failed reply has no text and is left out.
export function buildPrompt({ scope, history }: PromptInput): ChatMessage[] {
  const chat = history.map(({ role, text }) => ({ role, content: render('prompt', text, scope) })).filter((message) => message.content !== '');
  const { card } = scope;
  if (!card) return chat;
  const main = card.systemPrompt.trim() ? card.systemPrompt.replaceAll('{{original}}', MAIN) : MAIN;
  const about = [
    main,
    card.description,
    card.personality && `{{char}}'s personality: ${card.personality}`,
    card.scenario && `Scenario: ${card.scenario}`,
    card.exampleDialogue && `Example dialogue:\n${card.exampleDialogue}`,
  ].filter((part) => part.trim() !== '');
  const after = card.postHistoryInstructions.trim();
  return [
    { role: 'system', content: render('prompt', about.join('\n\n'), scope) },
    ...chat,
    ...(after ? [{ role: 'system' as const, content: render('prompt', after, scope) }] : []),
  ];
}

export type Unused = { kind: 'lorebook' | 'regex' | 'cbs' | 'variables' | 'toggles' | 'bias' | 'utility'; count: number };

// How many CBS tags this cut leaves in the text as written: those render does not fill, except
// {{original}}, which buildPrompt fills with MAIN.
function unfilled(text: string): number {
  return [...text.matchAll(CBS_TAG)].filter(([, inner]) => {
    const name = inner!.trim().toLowerCase();
    return !FILLED.has(name) && name !== 'original';
  }).length;
}

// What the character brought that this cut's prompt does not use yet, so its chats can say so
// instead of quietly behaving unlike the bot.
export function unused(card: Card, lore: number): Unused[] {
  const texts = [card.systemPrompt, card.description, card.personality, card.scenario, card.exampleDialogue, card.postHistoryInstructions, ...card.greetings];
  const found: Unused[] = [
    { kind: 'lorebook', count: lore },
    { kind: 'regex', count: card.regex.length },
    { kind: 'cbs', count: texts.reduce((sum, text) => sum + unfilled(text), 0) },
    { kind: 'variables', count: card.variables.length },
    { kind: 'toggles', count: card.toggles.trim() ? 1 : 0 },
    { kind: 'bias', count: card.bias.length },
    { kind: 'utility', count: card.utility ? 1 : 0 },
  ];
  return found.filter((item) => item.count > 0);
}
