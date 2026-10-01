import type { ChatMessage } from '../connectors/types';
import type { Memory, MemoryRecord } from '../model/memory';
import type { Block, ChatRange, ConversationPrompt, MemoryPrompt, Role, SlotKind, TextBlock, TranslatePrompt, WrappedSlot } from '../model/prompt';
import { unescapeCbs } from './cbs/escape';
import { evaluate } from './cbs/evaluate';
import type { HistoryMessage } from './history';
import type { Card } from './import/types';
import { activate, merge, type Activation, type Fired, type LoreInput, type Operation } from './lorebook/activate';
import { parseDecorators } from './lorebook/decorators';
import { authorNote, contexts, renderChat, type ChatScope } from './render';
import { memoryBefore, memoryBudget, memoryFormat, spanText, standing, stateLimit, type MemoryInput, type MemorySent } from './memory';
import type { TranslationRequest } from './translate';

export type PromptInput = {
  scope: ChatScope & { prompt: ConversationPrompt; persona: NonNullable<ChatScope['persona']> };
  // The id of the reply being written. It rolls this request's random tags outside messages and its lorebook
  // probabilities, as each earlier reply's id rolled its own.
  seed: string;
  countTokens: (text: string) => number;
  // The tokens the prompt may take: the model's context less its reply length. null when the context is unknown,
  // and then nothing is dropped.
  budget: number | null;
  // 이어 쓰기: the chat's messages end with the cut reply, and the continue instruction goes last.
  continuing: boolean;
  // null while the chat's memory is off.
  memory: MemoryInput | null;
};

// Even the last message alone leaves the prompt over its budget.
export type TooLong = { kind: 'too-long'; tokens: number; budget: number };

// Where a sent message came from, for 요청 원문. slot is null for a text block.
export type From =
  | { kind: 'block'; name: string | null; slot: SlotKind | null }
  | { kind: 'lore'; name: string; slot: 'lorebook' | 'postEverything' }
  | { kind: 'depth'; name: string; depth: number }
  | { kind: 'continue' };

// parts[i] says where messages[i] came from and what it counts in o200k_base, an estimate for any other
// tokenizer. lore is every entry that fired, named as it was then; null for a chat with no card. memory: null while the
// chat's memory is off. dropped: the chat's messages the budget left out, oldest first.
export type Assembled = { messages: ChatMessage[]; parts: { from: From; tokens: number }[]; lore: (Fired & { name: string })[] | null; memory: MemorySent | null; dropped: number };

// The app's own sentence, not a prompt's. A trailing user message rather than an assistant prefill, which current
// Claude models refuse with 400.
const CONTINUE = 'Your previous reply was cut off. Continue it exactly from where it stopped. Do not repeat anything already written.';

type Lore = { id: string; role: Role; body: string };
type Sent = { message: ChatMessage; from: From };
type Part = Sent | ChatPart | CachePart;

// What the lorebook placed for one request, and how a text outside the chat's messages is rendered: what both sorts of
// prompt are laid out with.
type Laid = {
  card: Card | null;
  activation: Activation | null;
  lorebook: Lore[];
  last: Lore[];
  depths: (Lore & { depth: number })[];
  sides: { before: string[]; after: string[] };
  injections: Map<string, { body: string; operation: Operation }[]>;
  render: (text: string, place: string) => string;
  named: (id: string) => string;
};

// history: the messages the lorebook scans. variables: as the chat's messages left them.
function lay(scope: ChatScope, history: HistoryMessage[], variables: Map<string, string>, seed: string, tokens: (text: string) => number, language: string | null): Laid {
  const { card } = scope;
  const context = contexts(scope, 'prompt', language);
  // An entry costs what its body sends, so its CBS is evaluated before it is counted. The replays below count the
  // same bodies again.
  const count = remembered((body) => tokens(evaluate(body, context({ seed }, new Map(variables)))));
  const activation = card && activate(loreInput(card, scope, history, afterMatch(card, scope, count), seed, count));
  const names = new Map(scope.lore.map(({ id, value }) => [id, value.name]));

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
        add(positions, placement.name, body);
        break;
      case 'inject':
        add(injections, placement.target, { body, operation: placement.operation });
        break;
    }
  }

  return {
    card,
    activation,
    lorebook,
    last,
    depths,
    sides,
    injections,
    // Each text outside the chat's messages rolls its random tags anew for each request, apart from every other
    // text, and reads the variables as the chat's messages left them.
    render: (text, place) => unescapeCbs(evaluate(atPositions(text, positions), context({ seed: `${seed}:${place}` }, new Map(variables)))).trim(),
    named: (id) => names.get(id)!,
  };
}

// What only one sort of prompt fills: a conversation its 작가의 노트, a translation 앞 메시지 (by how many messages it
// holds) and 원문, a memory task 정리할 메시지; 장기 기억 is a conversation's memory as sent, or what a memory task follows.
type Filling =
  | { sort: 'conversation'; note: string; memory: string }
  | { sort: 'translate'; recent: (count: number) => string; source: string }
  | { sort: 'memory'; memory: string; span: string };

const loreMessage = ({ render }: Laid, { id, role, body }: Lore): ChatMessage => ({ role, content: render(body, id) });
const throughSlot = (laid: Laid, entries: Lore[], slot: 'lorebook' | 'postEverything') =>
  entries.map((entry): Sent => ({ message: loreMessage(laid, entry), from: { kind: 'lore', name: laid.named(entry.id), slot } }));
const filled = (parts: Sent[]) => parts.filter(({ message }) => message.content !== '');

// A prompt's blocks in order, with its chat slots left open and every other block rendered once. memory: whether a
// 장기 기억 slot reaches the request, its 감싸는 글 keeping {{slot}} once rendered, whether or not memory holds anything.
function templateOf(blocks: Block[], laid: Laid, persona: ChatScope['persona'], filling: Filling): { parts: Part[]; memory: boolean } {
  const { card, render, sides, injections } = laid;
  const parts: Part[] = [];
  let memory = false;
  const out = (...sent: Sent[]) => parts.push(...filled(sent));
  // What a card or a persona holds is CBS of its own, evaluated inside its 감싸는 글.
  const wrapped = (block: WrappedSlot, content: string) => {
    if (content.trim()) out({ message: { role: block.role, content: render(block.wrapper === null ? content : block.wrapper.replace('{{slot}}', () => content), block.id) }, from: blockFrom(block) });
  };
  // Text already rendered, or the user's own, is never evaluated again: only its 감싸는 글 is. {{slot}} survives that
  // evaluation because the slot tag takes an argument (cbs/tags.ts), and one without it stays as written.
  const verbatim = (block: WrappedSlot, content: string) => {
    const frame = block.wrapper === null ? '{{slot}}' : render(block.wrapper, block.id);
    const text = content.trim();
    if (text) out({ message: { role: block.role, content: frame.replace('{{slot}}', () => text) }, from: blockFrom(block) });
    return frame.includes('{{slot}}');
  };
  for (const block of blocks) {
    if (block.kind === 'text') out({ message: { role: block.role, content: render(injected(ownText(block, card), block.mark === null ? [] : (injections.get(block.mark) ?? [])), block.id) }, from: blockFrom(block) });
    else
      switch (block.slot) {
        case 'description':
          wrapped(block, [...sides.before, ...describe(card), ...sides.after].filter((part) => part.trim()).join('\n\n'));
          break;
        case 'persona':
          wrapped(block, persona?.description ?? '');
          break;
        case 'authorNote':
          if (filling.sort === 'conversation') wrapped(block, filling.note);
          break;
        case 'lorebook':
          out(...throughSlot(laid, laid.lorebook, 'lorebook'));
          break;
        // 최종 삽입: where it stands, or at the very end when the prompt has none (assemble).
        case 'postEverything':
          out(...throughSlot(laid, laid.last, 'postEverything'));
          break;
        case 'chat':
          parts.push({ range: block.range, from: blockFrom(block) });
          break;
        case 'recent':
          if (filling.sort === 'translate') verbatim(block, filling.recent(block.count));
          break;
        case 'source':
          if (filling.sort === 'translate') verbatim(block, filling.source);
          break;
        case 'memory':
          if (filling.sort !== 'translate') memory = verbatim(block, filling.memory);
          break;
        case 'span':
          if (filling.sort === 'memory') verbatim(block, filling.span);
          break;
      }
    if (block.cache) parts.push({ cache: true });
  }
  return { parts, memory };
}

// A conversation prompt's blocks, in order, as the messages sent. Messages left empty are dropped.
// The messages memory covers leave the chat slots, though their variables are still replayed (renderChat renders them
// all) and the lorebook still scans them.
export function assemble({ scope, seed, countTokens, budget, continuing, memory }: PromptInput): Assembled | TooLong {
  const { prompt } = scope;
  const chat = renderChat('prompt', scope);
  const tokens = remembered(countTokens);
  const laid = lay(scope, scope.messages, chat.variables, seed, tokens, null);
  const { activation, named } = laid;
  const recalled = memory && standing(memory.memory, { shown: memory.shown, roles: scope.messages.map(({ role }) => role), texts: chat.texts }, memoryBudget(memory.budget, budget), tokens);
  const covered = recalled?.covered ?? 0;

  const { parts: template, memory: slot } = templateOf(prompt.blocks, laid, scope.persona, { sort: 'conversation', note: authorNote(scope.note, prompt), memory: recalled?.text ?? '' });
  const out = (...parts: Sent[]) => template.push(...filled(parts));
  if (!prompt.blocks.some((block) => block.kind === 'slot' && block.slot === 'postEverything')) out(...throughSlot(laid, laid.last, 'postEverything'));
  if (continuing) out({ message: { role: 'user', content: CONTINUE }, from: { kind: 'continue' } });

  const messages = chat.texts
    .slice(covered)
    .map((text, offset) => ({ role: scope.messages[covered + offset]!.role, content: text.trim() }))
    .filter(({ content }) => content !== '');
  const atDepth = laid.depths.map((entry) => ({ depth: entry.depth, sent: { message: loreMessage(laid, entry), from: { kind: 'depth', name: named(entry.id), depth: entry.depth } } satisfies Sent })).filter(({ sent }) => sent.message.content !== '');
  const fill = (kept: ChatMessage[]) => {
    // An entry at @@depth N goes before the message N from the end, wherever that message is.
    const before = new Map<number, Sent[]>();
    for (const { depth, sent } of atDepth) {
      const at = Math.max(kept.length - depth, 0);
      add(before, at, sent);
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
      memory: recalled && { sent: recalled.sent, covered, missing: slot ? covered - recalled.held : covered, slot },
      dropped: from,
    };
  };

  // The budget drops the oldest chat messages first and never the last one; the rest of the template stays whole.
  // What does not fit even then is not sent.
  let from = 0;
  let sent = fill(messages);
  if (budget === null) return assembled(sent);
  while (size(sent) > budget && from < messages.length - 1) sent = fill(messages.slice(++from));
  const used = size(sent);
  return used > budget ? { kind: 'too-long', tokens: used, budget } : assembled(sent);
}

// How much of each message before the source 앞 메시지 holds, from its end.
const TAIL_CHARS = 1500;

export type TranslationInput = {
  // The chat's, its messages as shown.
  scope: ChatScope;
  // The display scripts that draw the status window (상태창 지정), whose boxes a message's source leaves out.
  take: ReadonlySet<number>;
  prompt: TranslatePrompt;
  // Each of scope.messages' translation text, or null.
  translations: (string | null)[];
  request: TranslationRequest;
  // What {{language}} reads: the language translated into.
  language: string;
  // Rolls the request's random tags and its lorebook probabilities.
  seed: string;
  countTokens: (text: string) => number;
};

// A translation prompt's blocks as the messages sent. source is what goes out to be translated: a message as it is
// displayed (after its CBS and display scripts), which is what the reader would otherwise read, or the user's input.
// A translation holds no chat, so entries placed at a depth, or into a text a card replaces, are not sent in it.
export function assembleTranslation({ scope, take, prompt, translations, request, language, seed, countTokens }: TranslationInput): { source: string; messages: ChatMessage[] } {
  const { texts, variables } = renderChat('display', scope, take);
  const before = request.kind === 'message' ? request.index : texts.length;
  const source = request.kind === 'message' ? texts[request.index]! : request.text;
  const history = request.kind === 'message' ? scope.messages.slice(0, request.index + 1) : [...scope.messages, { id: seed, seed, role: 'user' as const, text: request.text, time: null }];
  const laid = lay(scope, history, variables, seed, remembered(countTokens), language);
  const recent = (count: number) => {
    const from = Math.max(before - count, 0);
    return texts
      .slice(from, before)
      .map((text, offset) => {
        const at = from + offset;
        const speaker = scope.messages[at]!.role === 'user' ? (scope.persona?.name ?? 'User') : (scope.card?.name ?? 'Assistant');
        const translation = translations[at];
        return [`[${speaker}]`, text.slice(-TAIL_CHARS), ...(translation ? ['Its translation:', translation.slice(-TAIL_CHARS)] : [])].join('\n');
      })
      .join('\n\n');
  };
  const { parts } = templateOf(prompt.blocks, laid, scope.persona, { sort: 'translate', recent, source });
  return { source, messages: cachePoints(parts.filter((part): part is Sent | CachePart => !('range' in part))).map(({ message }) => message) };
}

export type MemoryTaskInput = {
  // The chat's, its messages as a request sends them.
  scope: ChatScope;
  prompt: MemoryPrompt;
  // What the new records follow: the state and open threads, and the record before the span. budget: the 장기 기억 slot's
  // in the chat's requests, whose share the state may take.
  memory: Memory;
  before: MemoryRecord | null;
  budget: number;
  // The messages summarized, by place in scope.messages, from included and to not.
  span: { from: number; to: number };
  seed: string;
  countTokens: (text: string) => number;
};

// A memory prompt's blocks as the messages sent, then the app's answer format. span: the span's texts as the prompt
// renders them, variables replayed, which the answer is validated against and the records' fingerprints are made of.
// Like a translation, a memory task holds no chat, so entries placed at a depth are not sent in it.
export function assembleMemory({ scope, prompt, memory, before, budget, span: { from, to }, seed, countTokens }: MemoryTaskInput): { messages: ChatMessage[]; span: string[] } {
  const { texts, variables } = renderChat('prompt', scope);
  const laid = lay(scope, scope.messages.slice(0, to), variables, seed, remembered(countTokens), null);
  const speaker = (role: 'user' | 'assistant') => (role === 'user' ? (scope.persona?.name ?? 'User') : (scope.card?.name ?? 'Assistant'));
  const span = texts.slice(from, to);
  const shown = spanText(span.map((text, offset) => ({ speaker: speaker(scope.messages[from + offset]!.role), text: text.trim() })));
  const { parts } = templateOf(prompt.blocks, laid, scope.persona, { sort: 'memory', memory: memoryBefore(memory, before, stateLimit(budget), countTokens), span: shown });
  const messages = cachePoints(parts.filter((part): part is Sent | CachePart => !('range' in part))).map(({ message }) => message);
  return { messages: [...messages, { role: 'user', content: memoryFormat(to - from) }], span };
}

type ChatPart = { range: ChatRange; from: From };
type CachePart = { cache: true };

// Before the chat and at its end, never at the request's end: a block after the chat changes every turn. A @@depth
// entry sits among the chat's messages, so it opens the chat as a message does. Before 장기 기억 too when it comes
// before the chat (design §6.2, Cache): memory changes only at a boundary, so the fixed part before it is never written again.
export function autoCachePoints(roles: readonly ('chat' | 'depth' | 'memory' | null)[]): number[] {
  const first = roles.findIndex((role) => role === 'chat' || role === 'depth');
  const last = roles.lastIndexOf('chat');
  const memory = roles.indexOf('memory');
  const anchor = memory > 0 && (first === -1 || memory < first) ? [memory - 1] : [];
  return [...new Set([...anchor, ...(first > 0 ? [first - 1] : []), ...(last === -1 ? [] : [last])])];
}

// The cache points: the last message sent up to each block marked 여기까지 캐시, and the app's own.
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
  const role = ({ from }: Sent) => (from.kind === 'depth' ? 'depth' : from.kind === 'block' && (from.slot === 'chat' || from.slot === 'memory') ? from.slot : null);
  for (const index of autoCachePoints(sent.map(role))) point(index);
  return sent;
}

function add<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
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

// Which after-match entries went into the prompts of the replies before this one. It is not stored: like the
// variables, it is replayed from the chat, each earlier reply's activation rolled again from its seed.
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

export type Unused = { kind: 'bias' | 'utility' | 'lua' | 'trigger'; count: number };

// What the character brought that its chats do not use yet, so they can say so instead of quietly behaving unlike
// the bot.
export function unused(card: Card): Unused[] {
  const found: Unused[] = [
    { kind: 'bias', count: card.bias.length },
    { kind: 'utility', count: card.utility ? 1 : 0 },
    { kind: 'lua', count: card.triggers.filter((trigger) => trigger.kind === 'lua').length },
    { kind: 'trigger', count: card.triggers.filter((trigger) => trigger.kind === 'blocks').length },
  ];
  return found.filter((item) => item.count > 0);
}
