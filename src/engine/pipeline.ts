import type { ChatMessage } from '../connectors/types';
import type { Block, ChatRange, Prompt, Role, SlotKind, TextBlock, WrappedSlot } from '../model/prompt';
import { unescapeCbs } from './cbs/escape';
import { evaluate } from './cbs/evaluate';
import type { HistoryMessage } from './history';
import type { Card } from './import/types';
import { activate, merge, type Fired, type LoreInput, type Operation } from './lorebook/activate';
import { parseDecorators } from './lorebook/decorators';
import { authorNote, contexts, renderChat, type ChatScope } from './render';

export type PromptInput = {
  scope: ChatScope & { prompt: Prompt; persona: NonNullable<ChatScope['persona']> };
  // The id of the reply being written. It rolls this request's random tags outside messages and its lorebook
  // probabilities, as each earlier reply's id rolled its own.
  seed: string;
  countTokens: (text: string) => number;
  // The tokens the prompt may take: the model's context less its reply length. null when the context is unknown,
  // and then nothing is dropped.
  budget: number | null;
  // 이어 쓰기: the chat's messages end with the cut reply, and the continue instruction goes last.
  continuing: boolean;
};

// Even the last message alone leaves the prompt over its budget.
export type TooLong = { kind: 'too-long'; tokens: number; budget: number };

// Where a sent message came from, for 요청 원문 (design F3): a prompt block with its own name (slot null for a text
// block); a lorebook entry sent through the 로어북 or 최종 삽입 slot, or at @@depth before a chat message; or the
// continue instruction.
export type From =
  | { kind: 'block'; name: string | null; slot: SlotKind | null }
  | { kind: 'lore'; name: string; slot: 'lorebook' | 'postEverything' }
  | { kind: 'depth'; name: string; depth: number }
  | { kind: 'continue' };

// parts[i] says where messages[i] came from and what it counts in o200k_base, an estimate for any other
// tokenizer. lore is every entry that fired, named as it was then; null for a chat with no card.
export type Assembled = { messages: ChatMessage[]; parts: { from: From; tokens: number }[]; lore: (Fired & { name: string })[] | null };

// The app's own sentence, not a prompt's (user ruling 2026-09-29: "앱이 정한 문장"). It is a trailing user message
// rather than an assistant prefill, which current Claude models refuse with 400.
const CONTINUE = 'Your previous reply was cut off. Continue it exactly from where it stopped. Do not repeat anything already written.';

type Lore = { id: string; role: Role; body: string };
type Sent = { message: ChatMessage; from: From };

// A prompt's blocks, in order, as the messages sent (design §4.2, §5 Prompt template). Messages left empty are
// dropped.
export function assemble({ scope, seed, countTokens, budget, continuing }: PromptInput): Assembled | TooLong {
  const { card, prompt } = scope;
  const chat = renderChat('prompt', scope);
  const context = contexts(scope, 'prompt');
  const tokens = remembered(countTokens);
  // An entry costs what its body sends, so its CBS is evaluated before it is counted. The replays below count the
  // same bodies again.
  const count = remembered((body) => tokens(evaluate(body, context({ seed }, new Map(chat.variables)))));
  const activation = card && activate(loreInput(card, scope, scope.messages, afterMatch(card, scope, count), seed, count));
  const names = new Map(scope.lore.map(({ id, value }) => [id, value.name]));
  const named = (id: string) => names.get(id)!;

  const lorebook: Lore[] = [];
  const last: Lore[] = [];
  const depths: (Lore & { depth: number })[] = [];
  const sides = { before: [] as string[], after: [] as string[] };
  const positions = new Map<string, string[]>();
  const injections = new Map<string, { body: string; operation: Operation }[]>();
  for (const { id, body, placement } of activation?.placed ?? []) {
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
  const render = (text: string, place: string) => unescapeCbs(evaluate(atPositions(text, positions), context({ seed: `${seed}:${place}` }, new Map(chat.variables)))).trim();
  const loreMessage = ({ id, role, body }: Lore): ChatMessage => ({ role, content: render(body, id) });
  const throughSlot = (entries: Lore[], slot: 'lorebook' | 'postEverything') => entries.map((entry): Sent => ({ message: loreMessage(entry), from: { kind: 'lore', name: named(entry.id), slot } }));

  // The template with its chat slots left open, every other block rendered once.
  const template: (Sent | ChatPart | CachePart)[] = [];
  const out = (...parts: Sent[]) => template.push(...parts.filter(({ message }) => message.content !== ''));
  const wrapped = (block: WrappedSlot, content: string) => {
    if (content.trim()) out({ message: { role: block.role, content: render(block.wrapper === null ? content : block.wrapper.replace('{{slot}}', () => content), block.id) }, from: blockFrom(block) });
  };
  for (const block of prompt.blocks) {
    if (block.kind === 'text') out({ message: { role: block.role, content: render(injected(ownText(block, card), block.mark === null ? [] : (injections.get(block.mark) ?? [])), block.id) }, from: blockFrom(block) });
    else
      switch (block.slot) {
        case 'description':
          wrapped(block, [...sides.before, ...describe(card), ...sides.after].filter((part) => part.trim()).join('\n\n'));
          break;
        case 'persona':
          wrapped(block, scope.persona.description);
          break;
        case 'authorNote':
          wrapped(block, authorNote(scope.note, prompt));
          break;
        case 'lorebook':
          out(...throughSlot(lorebook, 'lorebook'));
          break;
        // 최종 삽입 (design §4.2): where it stands, and at the very end when the prompt has none (below).
        case 'postEverything':
          out(...throughSlot(last, 'postEverything'));
          break;
        case 'chat':
          template.push({ range: block.range, from: blockFrom(block) });
          break;
      }
    if (block.cache) template.push({ cache: true });
  }
  if (!prompt.blocks.some((block) => block.kind === 'slot' && block.slot === 'postEverything')) out(...throughSlot(last, 'postEverything'));
  if (continuing) out({ message: { role: 'user', content: CONTINUE }, from: { kind: 'continue' } });

  const messages = chat.texts.map((text, index) => ({ role: scope.messages[index]!.role, content: text.trim() })).filter(({ content }) => content !== '');
  const atDepth = depths.map((entry) => ({ depth: entry.depth, sent: { message: loreMessage(entry), from: { kind: 'depth', name: named(entry.id), depth: entry.depth } } satisfies Sent })).filter(({ sent }) => sent.message.content !== '');
  const fill = (kept: ChatMessage[]) => {
    // An entry at @@depth N goes before the message N from the end (design §5 row 3), and wherever that message is.
    const before = new Map<number, Sent[]>();
    for (const { depth, sent } of atDepth) {
      const at = Math.max(kept.length - depth, 0);
      before.set(at, [...(before.get(at) ?? []), sent]);
    }
    return template.flatMap((part) => ('range' in part ? range(kept, before, part) : [part]));
  };
  const size = (parts: (Sent | CachePart)[]) => parts.reduce((sum, part) => sum + ('cache' in part ? 0 : tokens(part.message.content)), 0);
  const assembled = (parts: (Sent | CachePart)[]): Assembled => {
    const sent = cachePoints(parts);
    return {
      messages: sent.map(({ message }) => message),
    parts: sent.map(({ message, from }) => ({ from, tokens: tokens(message.content) })),
      lore: activation && activation.fired.map((fired) => ({ ...fired, name: named(fired.id) })),
    };
  };

  // The context budget (decided 2026-09-28) drops the oldest chat messages first and never the last one; the rest
  // of the template stays whole. What does not fit even then is not sent.
  let from = 0;
  let sent = fill(messages);
  if (budget === null) return assembled(sent);
  while (size(sent) > budget && from < messages.length - 1) sent = fill(messages.slice(++from));
  const used = size(sent);
  return used > budget ? { kind: 'too-long', tokens: used, budget } : assembled(sent);
}

type ChatPart = { range: ChatRange; from: From };
type CachePart = { cache: true };

// The cache points (design §4.4): the last message sent up to each block marked 여기까지 캐시, and two the app sets
// itself, which the editor's cacheMarks draws (keep the two in step). One ends the part before the chat, which stays
// the same from turn to turn; the other is the chat's last message, which the next turn's request repeats. Not the request's last message: a block after the chat (글로벌 노트, 최종 삽입, the continue
// instruction) moves on every turn, so a point there is never met again.
function cachePoints(parts: (Sent | CachePart)[]): Sent[] {
  const sent: Sent[] = [];
  const point = (index: number) => {
    const part = sent[index]!;
    sent[index] = { ...part, message: { ...part.message, cache: true } };
  };
  for (const part of parts) {
    if (!('cache' in part)) sent.push(part);
    else if (sent.length) point(sent.length - 1);
  }
  const chat = (from: From) => from.kind === 'block' && from.slot === 'chat';
  // An entry at @@depth is placed among the chat's messages, so it starts the chat's part as much as a message does.
  const first = sent.findIndex(({ from }) => chat(from) || from.kind === 'depth');
  if (first > 0) point(first - 1);
  const last = sent.findLastIndex(({ from }) => chat(from));
  if (last !== -1) point(last);
  return sent;
}

const blockFrom = (block: Block): From => ({ kind: 'block', name: block.name, slot: block.kind === 'slot' ? block.slot : null });

function range(kept: ChatMessage[], before: Map<number, Sent[]>, { range: { from, to }, from: slot }: ChatPart): Sent[] {
  const at = (n: number) => (n < 0 ? Math.max(kept.length + n, 0) : Math.min(n, kept.length));
  const out: Sent[] = [];
  for (let index = at(from); index < (to === null ? kept.length : at(to)); index++) out.push(...(before.get(index) ?? []), { message: kept[index]!, from: slot });
  return out;
}

function remembered(measure: (text: string) => number): (text: string) => number {
  const held = new Map<string, number>();
  return (text) => {
    let value = held.get(text);
    if (value === undefined) {
      value = measure(text);
      held.set(text, value);
    }
    return value;
  };
}

function loreInput(card: Card, scope: ChatScope, history: HistoryMessage[], afterMatch: string[], seed: string, countTokens: (text: string) => number): LoreInput {
  return { entries: scope.lore, settings: card.loreSettings, history, turn: history.length, greeting: scope.greeting && scope.greeting.index, afterMatch, seed, countTokens };
}

const AFTER_MATCH = new Set(['keep_activate_after_match', 'dont_activate_after_match']);
const declaresAfterMatch = (content: string) =>
  parseDecorators(content).decorators.some(({ name, fallbacks }) => [name, ...fallbacks.map((line) => line.name)].some((each) => AFTER_MATCH.has(each)));

// Which after-match entries went into the prompts of the replies before this one (design §5 row 8). It is not
// stored: like the variables (row 17), it is replayed from the chat, each earlier reply's activation rolled again
// from its seed, which is the id its own request rolled from (or, for a branch's copy, the original's).
function afterMatch(card: Card, scope: ChatScope, countTokens: (text: string) => number): string[] {
  let state: string[] = [];
  if (!scope.lore.some(({ value }) => declaresAfterMatch(value.content))) return state;
  scope.messages.forEach((message, index) => {
    if (message.role === 'user' || (index === 0 && scope.greeting !== null)) return;
    state = activate(loreInput(card, scope, scope.messages.slice(0, index), state, message.seed, countTokens)).afterMatch;
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
