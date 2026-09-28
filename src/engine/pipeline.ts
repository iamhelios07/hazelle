import type { ChatMessage } from '../connectors/types';
import type { ChatRange, Prompt, Role, TextBlock } from '../model/prompt';
import { unescapeCbs } from './cbs/escape';
import { evaluate } from './cbs/evaluate';
import type { HistoryMessage } from './history';
import type { Card } from './import/types';
import { activate, merge, type LoreInput, type Operation } from './lorebook/activate';
import { parseDecorators } from './lorebook/decorators';
import { authorNote, contexts, renderChat, type ChatScope } from './render';

export type PromptInput = {
  scope: ChatScope & { prompt: Prompt; persona: NonNullable<ChatScope['persona']> };
  // The id of the reply being written. It rolls this request's random tags outside messages and its lorebook
  // probabilities, as each earlier reply's id rolled its own.
  seed: string;
  countTokens: (text: string) => number;
};

type Lore = { id: string; role: Role; body: string };

// A prompt's blocks, in order, as the messages sent (design §4.2, §5 Prompt template). Messages left empty are
// dropped.
export function assemble({ scope, seed, countTokens }: PromptInput): ChatMessage[] {
  const { card, prompt } = scope;
  const chat = renderChat('prompt', scope);
  const context = contexts(scope, 'prompt');
  // An entry costs what its body sends, so its CBS is evaluated before it is counted. The replays below count the
  // same bodies again.
  const counted = new Map<string, number>();
  const count = (body: string) => {
    let tokens = counted.get(body);
    if (tokens === undefined) {
      tokens = countTokens(evaluate(body, context({ seed }, new Map(chat.variables))));
      counted.set(body, tokens);
    }
    return tokens;
  };
  const placed = card ? activate(loreInput(card, scope, scope.messages, afterMatch(card, scope, count), seed, count)).placed : [];

  const lorebook: Lore[] = [];
  const last: Lore[] = [];
  const depths: (Lore & { depth: number })[] = [];
  const sides = { before: [] as string[], after: [] as string[] };
  const positions = new Map<string, string[]>();
  const injections = new Map<string, { body: string; operation: Operation }[]>();
  for (const { id, body, placement } of placed) {
    switch (placement.kind) {
      case 'lorebook':
        lorebook.push({ id, role: placement.role, body });
        break;
      case 'depth':
        if (placement.depth === 0) last.push({ id, role: placement.role, body });
        else depths.push({ id, role: placement.role, body, depth: placement.depth });
        break;
      case 'description':
        sides[placement.side].push(body);
        break;
      case 'position':
        positions.set(placement.name, [...(positions.get(placement.name) ?? []), body]);
        break;
      case 'inject':
        injections.set(placement.target, [...(injections.get(placement.target) ?? []), { body, operation: placement.operation }]);
        break;
    }
  }

  // Each text outside the chat's messages rolls its random tags anew for each request, apart from every other
  // text (design §5 row 11), and reads the variables as the chat's messages left them.
  const render = (text: string, place: string) => unescapeCbs(evaluate(atPositions(text, positions), context({ seed: `${seed}:${place}` }, new Map(chat.variables))));
  const loreMessage = ({ id, role, body }: Lore): ChatMessage => ({ role, content: render(body, id) });

  const sent = chat.texts.flatMap((content, index) => (content.trim() ? [{ role: scope.messages[index]!.role, content }] : []));
  // An entry at @@depth N goes before the message N from the end (design §5 row 3), and wherever that message is.
  const before = new Map<number, ChatMessage[]>();
  for (const entry of depths) {
    const at = Math.max(sent.length - entry.depth, 0);
    before.set(at, [...(before.get(at) ?? []), loreMessage(entry)]);
  }
  const range = ({ from, to }: ChatRange) => {
    const at = (n: number) => (n < 0 ? Math.max(sent.length + n, 0) : Math.min(n, sent.length));
    const out: ChatMessage[] = [];
    for (let index = at(from); index < (to === null ? sent.length : at(to)); index++) out.push(...(before.get(index) ?? []), sent[index]!);
    return out;
  };

  const out: ChatMessage[] = [];
  const wrapped = (role: Role, wrapper: string | null, content: string, place: string) => {
    if (content.trim()) out.push({ role, content: render(wrapper === null ? content : wrapper.replace('{{slot}}', () => content), place) });
  };
  for (const block of prompt.blocks) {
    if (block.kind === 'text') {
      out.push({ role: block.role, content: render(injected(ownText(block, card), block.mark === null ? [] : (injections.get(block.mark) ?? [])), block.id) });
      continue;
    }
    switch (block.slot) {
      case 'description':
        wrapped(block.role, block.wrapper, [...sides.before, ...describe(card), ...sides.after].filter((part) => part.trim()).join('\n\n'), block.id);
        break;
      case 'persona':
        wrapped(block.role, block.wrapper, scope.persona.description, block.id);
        break;
      case 'authorNote':
        wrapped(block.role, block.wrapper, authorNote(scope.note, prompt), block.id);
        break;
      case 'lorebook':
        out.push(...lorebook.map(loreMessage));
        break;
      // 최종 삽입 (design §4.2): where it stands, and at the very end when the prompt has none (below).
      case 'postEverything':
        out.push(...last.map(loreMessage));
        break;
      case 'chat':
        out.push(...range(block.range));
        break;
    }
  }
  if (!prompt.blocks.some((block) => block.kind === 'slot' && block.slot === 'postEverything')) out.push(...last.map(loreMessage));
  return out.map(({ role, content }) => ({ role, content: content.trim() })).filter(({ content }) => content !== '');
}

function loreInput(card: Card, scope: ChatScope, history: HistoryMessage[], afterMatch: string[], seed: string, countTokens: (text: string) => number): LoreInput {
  return { entries: scope.lore, settings: card.loreSettings, history, turn: history.length, greeting: scope.greeting && scope.greeting.index, afterMatch, seed, countTokens };
}

const AFTER_MATCH = new Set(['keep_activate_after_match', 'dont_activate_after_match']);
const declaresAfterMatch = (content: string) =>
  parseDecorators(content).decorators.some(({ name, fallbacks }) => [name, ...fallbacks.map((line) => line.name)].some((each) => AFTER_MATCH.has(each)));

// Which after-match entries went into the prompts of the replies before this one (design §5 row 8). It is not
// stored: like the variables (row 17), it is replayed from the chat, each earlier reply's activation rolled again
// from its version id, the seed its own request used.
function afterMatch(card: Card, scope: ChatScope, countTokens: (text: string) => number): string[] {
  let state: string[] = [];
  if (!scope.lore.some(({ value }) => declaresAfterMatch(value.content))) return state;
  scope.messages.forEach((message, index) => {
    if (message.role === 'user' || (index === 0 && scope.greeting !== null)) return;
    state = activate(loreInput(card, scope, scope.messages.slice(0, index), state, message.id, countTokens)).afterMatch;
  });
  return state;
}

// The main text and the global note are the ones a card replaces, with {{original}} for the prompt's own.
function ownText({ text, mark }: TextBlock, card: Card | null): string {
  const replacement = mark === 'main' ? card?.systemPrompt : mark === 'globalNote' ? card?.postHistoryInstructions : undefined;
  return replacement?.trim() ? replacement.replaceAll('{{original}}', () => text) : text;
}

// @@inject_at names a text block by its mark, main or globalNote: the names Risu's own entries target.
function injected(text: string, injections: { body: string; operation: Operation }[]): string {
  return injections.reduce((target, { body, operation }) => merge(target, body, operation) ?? target, text);
}

// {{position::name}} holds the entries placed there, a line each, and what they hold nests up to five deep
// (risu-compat-spec §e); a name no entry went to holds nothing.
const POSITION = /\{\{position::([^{}]*)\}\}/g;
function atPositions(text: string, positions: Map<string, string[]>): string {
  let out = text;
  for (let level = 0; level < 5; level++) {
    const next = out.replace(POSITION, (_, name: string) => positions.get(name)?.join('\n') ?? '');
    if (next === out) break;
    out = next;
  }
  return out;
}

// The character's definitions for the 캐릭터 설명 slot. Example dialogue has no slot of its own, so it goes here.
function describe(card: Card | null): string[] {
  if (!card) return [];
  return [
    card.description,
    card.personality && `{{char}}'s personality: ${card.personality}`,
    card.scenario && `Scenario: ${card.scenario}`,
    card.exampleDialogue && `Example dialogue:\n${card.exampleDialogue}`,
  ];
}

export type Unused = { kind: 'bias' | 'utility'; count: number };

// What the character brought that the prompt does not use yet, so its chats can say so instead of quietly
// behaving unlike the bot.
export function unused(card: Card): Unused[] {
  const found: Unused[] = [
    { kind: 'bias', count: card.bias.length },
    { kind: 'utility', count: card.utility ? 1 : 0 },
  ];
  return found.filter((item) => item.count > 0);
}
