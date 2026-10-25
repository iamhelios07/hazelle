import { priceCost } from '../connectors/pricing';
import type { Cost, Model } from '../connectors/types';
import type { PrereadPrompt } from '../model/prompt';
import type { PrereadParts, PrereadSettings } from '../model/settings';
import { fingerprint } from './memory';
import type { Assembled, From } from './pipeline';

// 토큰 절약: the 보조 model reads the chosen parts of a request about to be sent and writes a brief, which the chat model
// gets in their place. The idea is the Risu plugin pdf-pod's; this instruction was written fresh, without reading its
// prompts (user ruling, 2026-10-19).
const INSTRUCTION = [
  'You prepare reading notes for another model, which will write the next reply in an ongoing story. It will not see the material you are given; it sees only your notes and the latest messages. Write notes that let it continue as if it had read everything.',
  '',
  'Keep, as facts and in the material\'s own words where wording matters:',
  '- the current scene: where and when it is, who is present, what just happened and what is about to;',
  '- every established fact that could matter later: names, relationships, promises, debts, secrets, injuries, belongings, numbers, places;',
  '- each character\'s manner of speaking and how they treat the others;',
  '- open threads and anything the user\'s character is in the middle of;',
  '- from system or world material, every rule, format requirement or instruction, quoted exactly.',
  '',
  'Leave out repetition, finished side episodes and description that no longer bears on the story.',
  '',
  'Do not continue the story, do not invent, do not judge the content, and do not address the reader. Write in the language of the material. Answer with the notes only.',
].join('\n');

// The account's default 토큰 절약 prompt, added once (runtime/prompts). The instruction stays a system message ahead of
// the material, so the PDF the call may pack (runtime/preread) holds the material alone.
export function prereadTaskPrompt(): PrereadPrompt {
  const named = (name: string | null = null) => ({ id: crypto.randomUUID(), name });
  return {
    task: 'preread',
    name: '기본 토큰 절약',
    toggles: [],
    blocks: [
      { ...named('토큰 절약 지시'), kind: 'text', role: 'system', text: INSTRUCTION, mark: null },
      { ...named(), kind: 'slot', slot: 'source', role: 'user', wrapper: null },
    ],
  };
}

export type PrereadPart = keyof PrereadParts;

// null: never shortened, the app's own instruction at the end. The memory slot and found records count as system: they
// are a summary already.
export function partOf(from: From): PrereadPart | null {
  switch (from.kind) {
    case 'block':
      return from.slot === 'chat' ? 'chat' : 'system';
    case 'lore':
    case 'depth':
      return 'lore';
    case 'retrieval':
    case 'script':
    case 'tool':
      return 'system';
    case 'continue':
    case 'answer':
    case 'preread':
    case 'agents':
      return null;
  }
}

const HEADINGS: Record<PrereadPart, string> = { chat: 'chat', system: 'system', lore: 'lorebook' };

// Who a shortenable message is from one turn to the next. key: a chat message by its message id (the greeting, which
// has none, by its place first); any other part by where it came from, counted when it comes from there more than once.
// hash: what it said. message: a chat message's id.
export type Covered = { part: PrereadPart; key: string; hash: string; tokens: number; message?: string };

// taken: every message a brief may stand in for, in order, covered saying who each is. tokens: their o200k count.
export type PrereadPlan = { taken: number[]; covered: Covered[]; material: string; tokens: number };

function identities({ messages, parts }: Pick<Assembled, 'messages' | 'parts'>): (Covered | null)[] {
  const seen = new Map<string, number>();
  return messages.map(({ role, content }, at) => {
    const { from, tokens, origin } = parts[at]!;
    const part = partOf(from);
    if (!part) return null;
    const hash = fingerprint([{ role, text: content }]);
    if (part === 'chat') return { part, key: `chat:${origin ?? ''}`, hash, tokens, ...(origin !== undefined && { message: origin }) };
    const place = JSON.stringify(from);
    const count = seen.get(place) ?? 0;
    seen.set(place, count + 1);
    return { part, key: `${place}#${count}`, hash, tokens };
  });
}

// The latest recent chat messages and the latest user message stay as written. A message with pictures stays too: the
// brief is text, and its pictures would be lost.
export function prereadPlan(sent: Pick<Assembled, 'messages' | 'parts'>, { parts: chosen, recent }: Pick<PrereadSettings, 'parts' | 'recent'>): PrereadPlan | null {
  const { messages, parts } = sent;
  const chat = parts.flatMap(({ from }, at) => (from.kind === 'block' && from.slot === 'chat' ? [at] : []));
  const kept = new Set([...(recent > 0 ? chat.slice(-recent) : []), messages.findLastIndex(({ role }, at) => role === 'user' && partOf(parts[at]!.from) !== null)]);
  const who = identities(sent);
  const taken = messages.flatMap((message, at) => {
    const each = who[at];
    return each && chosen[each.part] && !kept.has(at) && !message.inlays ? [at] : [];
  });
  if (!taken.length) return null;
  const material = taken
    .map((at) => {
      const { role, content } = messages[at]!;
      const { part } = who[at]!;
      return `[${part === 'chat' ? `${HEADINGS.chat} · ${role}` : HEADINGS[part]}]\n${content}`;
    })
    .join('\n\n');
  return { taken, covered: taken.map((at) => who[at]!), material, tokens: taken.reduce((sum, at) => sum + parts[at]!.tokens, 0) };
}

const held = ({ key, hash }: Covered) => `${key}\n${hash}`;

// What an earlier brief still does for this request. replaced: the taken messages it stands in for; uncovered: the o200k
// tokens of the taken ones it does not, which go raw. stale: it says what the chat no longer does, a covered chat message
// gone from the chat (present: the chat's message ids) or changed, or a covered system message changed or gone. A chat
// message the budget left out is not gone; nor is a lorebook entry that did not fire: lore comes and goes with its
// keywords, and a fact the brief still holds does no harm.
export function coverage(sent: Pick<Assembled, 'messages' | 'parts'>, plan: PrereadPlan, covered: readonly Covered[], present: ReadonlySet<string>): { replaced: number[]; uncovered: number; stale: boolean } {
  const now = new Map(identities(sent).flatMap((who) => (who ? [[who.key, who.hash] as const] : [])));
  const stale = covered.some(({ part, key, hash, message }) =>
    part === 'chat' ? (message !== undefined && !present.has(message)) || (now.has(key) && now.get(key) !== hash) : part === 'system' && now.get(key) !== hash,
  );
  const holds = new Set(covered.map(held));
  const replaced = plan.taken.filter((_, at) => holds.has(held(plan.covered[at]!)));
  const uncovered = plan.covered.reduce((sum, each) => (holds.has(held(each)) ? sum : sum + each.tokens), 0);
  return { replaced, uncovered, stale };
}

// One system message, the brief, where the first replaced message stood; everything left keeps its order.
export function placeBrief(sent: Assembled, replaced: readonly number[], brief: string, tokens: number): Assembled {
  const gone = new Set(replaced);
  const messages: Assembled['messages'] = [];
  const parts: Assembled['parts'] = [];
  sent.messages.forEach((message, at) => {
    if (at === replaced[0]) {
      messages.push({ role: 'system', content: brief });
      parts.push({ from: { kind: 'preread' }, tokens });
    }
    if (gone.has(at)) return;
    messages.push(message);
    parts.push(sent.parts[at]!);
  });
  return { ...sent, messages, parts };
}

// What the brief saved on the chat model's input: the tokens it took out (taken, negative when the brief was longer) at
// that model's input rate, less what its own call cost on the turn it was made (spent, nothing on a turn that reused
// it). null when either is unknown, or they are in different units, which are never summed.
export function savedCost(taken: number, price: Model['price'], unit: Cost['unit'], spent: Cost | null): Cost | null {
  const input = price && priceCost(price, { inputTokens: Math.abs(taken), outputTokens: 0, reasoningTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null }, unit);
  if (!input || !spent || spent.unit !== unit) return null;
  return { unit, amount: Math.sign(taken) * input.amount - spent.amount, source: 'price-list' };
}
