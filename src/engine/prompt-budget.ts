import type { ChatMessage, Model } from '../connectors/types';
import type { ModelSettings } from '../connectors/settings';
import { prepareChat } from '../connectors/preparation';
import { requestRoute, type WireRoute } from '../connectors/registry';
import type { ChatRange } from '../model/prompt';
import type { CachePart, Sent } from './cache-points';
import type { Assembled, From } from './pipeline';

// Even the last message alone leaves the prompt over its budget.
export type TooLong = { kind: 'too-long'; tokens: number; budget: number };

type ChatPart = { range: ChatRange; from: From };
export type Part = Sent | ChatPart | CachePart;

export type ProviderFit = { allowance: number | null; route: WireRoute; model: Model; settings: ModelSettings };

export function wireTokens(fit: ProviderFit, messages: ChatMessage[], countTokens: (text: string) => number): number {
  const prepared = prepareChat(requestRoute(fit.route), { model: fit.model, settings: fit.settings, messages });
  return prepared.wire.segments.reduce((total, { text }) => total + countTokens(text), 0);
}

export function fitChat(template: Part[], messages: ChatMessage[], depths: { depth: number; sent: Sent }[], measure: (parts: (Sent | CachePart)[]) => number, allowance: number | null): { parts: (Sent | CachePart)[]; dropped: number } | TooLong {
  const partsAt = (dropped: number) => {
    const kept = messages.slice(dropped);
    // An entry at @@depth N goes before the message N from the end, wherever that message is.
    const before = new Map<number, Sent[]>();
    for (const { depth, sent } of depths) {
      const at = Math.max(kept.length - depth, 0);
      const entries = before.get(at);
      if (entries) entries.push(sent);
      else before.set(at, [sent]);
    }
    return template.flatMap((part) => ('range' in part ? range(kept, before, part) : [part]));
  };
  const dropped = dropOldest(allowance, messages.length, (cut) => measure(partsAt(cut)));
  return typeof dropped === 'number' ? { parts: partsAt(dropped), dropped } : dropped;
}

// The budget drops the oldest chat messages first and never the last one; what does not fit even then is not sent.
// size: the request's tokens with the oldest of its count chat messages dropped. Gives how many to drop.
// Signed and overlapping ranges need not shrink monotonically: search cuts in order.
function dropOldest(budget: number | null, count: number, size: (dropped: number) => number): number | TooLong {
  if (budget === null) return 0;
  let dropped = 0;
  let tokens = size(dropped);
  while (tokens > budget && dropped < count - 1) tokens = size(++dropped);
  return tokens > budget ? { kind: 'too-long', tokens, budget } : dropped;
}

// A message the script left as built keeps its part, any other is the script's and counted here. The budget holds
// for this request as it does in assemble, over the chat messages left as built.
export function rewritten(prompt: Assembled, messages: ChatMessage[], countTokens: (text: string) => number, fit: ProviderFit | null): Assembled | TooLong {
  const counts = new Map<string, number>();
  const tokens = (text: string) => {
    let count = counts.get(text);
    if (count === undefined) { count = countTokens(text); counts.set(text, count); }
    return count;
  };
  let next = 0;
  const sent = messages.map((message) => {
    let at = next;
    while (at < prompt.messages.length && (prompt.messages[at]!.role !== message.role || prompt.messages[at]!.content !== message.content)) at++;
    if (at === prompt.messages.length) return { message, from: { kind: 'script' } satisfies From, tokens: tokens(message.content) };
    next = at + 1;
    return { message, ...prompt.parts[at]! };
  });
  const chat = sent.flatMap(({ from }, at) => (from.kind === 'block' && from.slot === 'chat' ? [at] : []));
  const candidate = (dropped: number) => {
    const gone = new Set(chat.slice(0, dropped));
    return sent.filter((_, at) => !gone.has(at));
  };
  const dropped = dropOldest(fit?.allowance ?? null, chat.length, (cut) => wireTokens(fit!, candidate(cut).map(({ message }) => message), tokens));
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

