import type { ChatMessage } from '../connectors/types';
import type { ChatRange } from '../model/prompt';
import type { CachePart, Sent } from './cache-points';
import type { Assembled, From } from './pipeline';

// Even the last message alone leaves the prompt over its budget.
export type TooLong = { kind: 'too-long'; tokens: number; budget: number };

type ChatPart = { range: ChatRange; from: From };
export type Part = Sent | ChatPart | CachePart;

export function fitChat(template: Part[], messages: ChatMessage[], depths: { depth: number; sent: Sent }[], tokens: (text: string) => number, budget: number | null): { parts: (Sent | CachePart)[]; dropped: number } | TooLong {
  const size = budgetSize(template, messages, depths, tokens);
  const dropped = dropOldest(budget, messages.length, size);
  if (typeof dropped !== 'number') return dropped;
  const kept = messages.slice(dropped);
  // An entry at @@depth N goes before the message N from the end, wherever that message is.
  const before = new Map<number, Sent[]>();
  for (const { depth, sent } of depths) {
    const at = Math.max(kept.length - depth, 0);
    const entries = before.get(at);
    if (entries) entries.push(sent);
    else before.set(at, [sent]);
  }
  return { parts: template.flatMap((part) => ('range' in part ? range(kept, before, part) : [part])), dropped };
}

// The budget drops the oldest chat messages first and never the last one; what does not fit even then is not sent.
// size: the request's tokens with the oldest of its count chat messages dropped. Gives how many to drop.
// size may only be called with non-decreasing dropped; budgetSize advances its windows in place.
function dropOldest(budget: number | null, count: number, size: (dropped: number) => number): number | TooLong {
  if (budget === null) return 0;
  let dropped = 0;
  while (size(dropped) > budget && dropped < count - 1) dropped++;
  const tokens = size(dropped);
  return tokens > budget ? { kind: 'too-long', tokens, budget } : dropped;
}

// A message the script left as built keeps its part, any other is the script's and counted here. The budget holds
// for this request as it does in assemble, over the chat messages left as built.
export function rewritten(prompt: Assembled, messages: ChatMessage[], countTokens: (text: string) => number, budget: number | null): Assembled | TooLong {
  let next = 0;
  const sent = messages.map((message) => {
    let at = next;
    while (at < prompt.messages.length && (prompt.messages[at]!.role !== message.role || prompt.messages[at]!.content !== message.content)) at++;
    if (at === prompt.messages.length) return { message, from: { kind: 'script' } satisfies From, tokens: countTokens(message.content) };
    next = at + 1;
    return { message, ...prompt.parts[at]! };
  });
  const chat = sent.flatMap(({ from }, at) => (from.kind === 'block' && from.slot === 'chat' ? [at] : []));
  const total = sent.reduce((sum, { tokens }) => sum + tokens, 0);
  const before = [0];
  for (const at of chat) before.push(before.at(-1)! + sent[at]!.tokens);
  const dropped = dropOldest(budget, chat.length, (from) => total - before[from]!);
  if (typeof dropped !== 'number') return dropped;
  const gone = new Set(chat.slice(0, dropped));
  const kept = sent.filter((_, at) => !gone.has(at));
  return { ...prompt, messages: kept.map(({ message }) => message), parts: kept.map(({ from, tokens }) => ({ from, tokens })), dropped: prompt.dropped + dropped };
}

function range(kept: ChatMessage[], before: Map<number, Sent[]>, { range: { from, to }, from: slot }: ChatPart): Sent[] {
  const [start, end] = rangeBounds(kept.length, { from, to });
  const out: Sent[] = [];
  for (let index = start; index < end; index++) out.push(...(before.get(index) ?? []), { message: kept[index]!, from: slot });
  return out;
}

function rangeBounds(length: number, { from, to }: ChatRange): [number, number] {
  const at = (n: number) => (n < 0 ? Math.max(length + n, 0) : Math.min(n, length));
  return [at(from), to === null ? length : at(to)];
}

function budgetSize(template: Part[], messages: ChatMessage[], depths: { depth: number; sent: Sent }[], tokens: (text: string) => number): (dropped: number) => number {
  const ranges = template.filter((part): part is ChatPart => 'range' in part).map(({ range }) => ({ range, start: 0, end: 0, tokens: 0 }));
  const fixed = template.reduce((sum, part) => sum + ('message' in part ? tokens(part.message.content) : 0), 0);
  const ordered = [...depths].sort((a, b) => a.depth - b.depth);
  const depthPrefix = [0];
  for (const { sent } of ordered) depthPrefix.push(depthPrefix.at(-1)! + tokens(sent.message.content));
  const throughDepth = (depth: number) => {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ordered[middle]!.depth <= depth) low = middle + 1;
      else high = middle;
    }
    return depthPrefix[low]!;
  };
  return (dropped) => {
    const length = messages.length - dropped;
    let size = fixed;
    for (const held of ranges) {
      const [start, end] = rangeBounds(length, held.range);
      const absoluteStart = dropped + start;
      const absoluteEnd = dropped + Math.max(start, end);
      // dropOldest advances cuts in order: both absolute bounds only advance. Each text enters/leaves a slot
      // at most once; nothing outside the tried ranges is tokenized, including when no trimming is needed.
      // Costs themselves need not be monotone: overlapping signed ranges can gain messages as cuts advance.
      for (let at = held.start; at < Math.min(absoluteStart, held.end); at++) held.tokens -= tokens(messages[at]!.content);
      for (let at = Math.max(held.end, absoluteStart); at < absoluteEnd; at++) held.tokens += tokens(messages[at]!.content);
      held.start = absoluteStart;
      held.end = absoluteEnd;
      if (end <= start) continue;
      size += held.tokens;
      // Depths beyond the remaining history clamp to its first message, not outside the slot.
      size += (start === 0 ? depthPrefix.at(-1)! : throughDepth(length - start)) - throughDepth(length - end);
    }
    return size;
  };
}

