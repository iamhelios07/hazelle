import type { ChatMessage } from '../connectors/types';
import type { Card } from './import/types';

// The first-cut card prompt. The prompt template (design §5) replaces all of this, and with it this
// stand-in for the template's main text, which a card's system_prompt reaches as {{original}}.
const MAIN = "Write {{char}}'s next reply in this fictional roleplay with {{user}}. Stay in character, and never write {{user}}'s words or actions.";

const NAMES = /\{\{\s*(char|bot|user)\s*\}\}/gi;
// Any other CBS tag or block, which this cut leaves in the text as written.
const OTHER_CBS = /\{\{(?!\s*(?:char|bot|user|original)\s*\}\})[^{}]*\}\}/gi;

export function fillNames(text: string, card: Card, user: string): string {
  return text.replace(NAMES, (_, tag: string) => (tag.toLowerCase() === 'user' ? user : card.nickname || card.name));
}

export function cardPrompt(card: Card, user: string, chat: ChatMessage[]): ChatMessage[] {
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
    { role: 'system', content: fillNames(about.join('\n\n'), card, user) },
    ...chat,
    ...(after ? [{ role: 'system' as const, content: fillNames(after, card, user) }] : []),
  ];
}

export type Unused = { kind: 'lorebook' | 'regex' | 'cbs' | 'variables' | 'toggles' | 'bias' | 'utility'; count: number };

// What the character brought that this cut's prompt does not use yet, so its chats can say so
// instead of quietly behaving unlike the bot.
export function unused(card: Card, lore: number): Unused[] {
  const texts = [card.systemPrompt, card.description, card.personality, card.scenario, card.exampleDialogue, card.postHistoryInstructions, ...card.greetings];
  const found: Unused[] = [
    { kind: 'lorebook', count: lore },
    { kind: 'regex', count: card.regex.length },
    { kind: 'cbs', count: texts.reduce((sum, text) => sum + (text.match(OTHER_CBS)?.length ?? 0), 0) },
    { kind: 'variables', count: card.variables.length },
    { kind: 'toggles', count: card.toggles.trim() ? 1 : 0 },
    { kind: 'bias', count: card.bias.length },
    { kind: 'utility', count: card.utility ? 1 : 0 },
  ];
  return found.filter((item) => item.count > 0);
}
