import { costUnit, resolveConnection, type CacheFacts, type CacheView } from '../connectors/registry';
import { priceCost } from '../connectors/pricing';
import type { Cache } from '../connectors/settings';
import type { Connection, Cost, Model } from '../connectors/types';
import { fingerprint } from '../engine/memory';
import type { Assembled, From } from '../engine/pipeline';
import { cachePrintId, type CacheBreak, type CacheForecast, type CachePrint, type WireMessage } from '../model/cache';
import type { Message, Receipt } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { Role } from '../model/prompt';
import type { ObjectStore } from './store';

const TTL: Record<Cache, number> = { '5m': 5 * 60_000, '1h': 60 * 60_000 };

type LastCache = { call: string; until: number };

// The call left a cache to forecast against: it sent a point and reported reading or writing some. One that cached
// none (a prompt shorter than the model caches, a provider that ignores points, a call that failed) leaves the last.
export const cacheKept = ({ cache, usage }: Pick<Receipt, 'cache' | 'usage'>) => cache !== null && ((usage?.cachedInputTokens ?? 0) > 0 || (usage?.cacheWriteInputTokens ?? 0) > 0);

// A provider keeps a cache for the call's TTL from the call's start, and a read renews it as a write does. null when the
// chat's latest call that reported its counts kept none.
export function lastCache(messages: Message[]): LastCache | null {
  let latest: { at: number; receipt: Receipt } | null = null;
  for (const message of messages) {
    for (const { at, receipt } of message.versions) if (receipt?.usage && (!latest || at > latest.at)) latest = { at, receipt };
  }
  if (!latest) return null;
  const { cache, totalMs } = latest.receipt;
  return cacheKept(latest.receipt) ? { call: latest.receipt.id, until: latest.at - totalMs + TTL[cache!] } : null;
}

// Forecast minimums are o200k allowances from the conversation snapshot, not the connector's native counts.
export type CacheSend = Omit<CachePrint, 'call'> & { facts: CacheFacts | null };

export function wireOf(connection: string, account: string | null, view: CacheView, parts: Assembled['parts']): Omit<CachePrint, 'call'> {
  const messages = view.messages.map(({ role, content, index, cache }): WireMessage => ({ role, hash: fingerprint([{ role, text: content }]), tokens: parts[index]!.tokens, from: parts[index]!.from, ...(cache && { point: true as const }) }));
  return { connection, account, model: view.model, ...(view.reasoning !== undefined && { reasoning: view.reasoning }), messages };
}

export const chatPrint = (store: Pick<ObjectStore, 'children'>, chat: string): Stored<'cacheprint'> | undefined =>
  store.children('cacheprint', chat).find((print) => print.id === cachePrintId(chat));

// Replaced by each reply call that kept a cache (cacheKept), the one lastCache names.
export function writePrint(store: ObjectStore, chat: string, call: string, { connection, account, model, reasoning, messages }: Omit<CachePrint, 'call'>) {
  const value: CachePrint = { call, connection, account, model, ...(reasoning !== undefined && { reasoning }), messages };
  return store.withChat(chat, async () => {
    const id = cachePrintId(chat);
    if (!chatPrint(store, chat)) {
      const created = await store.create('cacheprint', value, { id, parent: chat });
      if (created.ok || created.error !== 'conflict' || !chatPrint(store, chat)) return created;
    }
    return store.update('cacheprint', id, () => value);
  });
}

// The last call to forecast against: the stored print, when it is of the call whose receipt keeps the cache's time.
// live: the time is not up at now.
export type Prior = { print: CachePrint; live: boolean };

export function prior(store: Pick<ObjectStore, 'children'>, chat: string, messages: Message[], now: number): Prior | null {
  const last = lastCache(messages);
  const print = chatPrint(store, chat)?.value;
  return last && print?.call === last.call ? { print, live: last.until > now } : null;
}

// Each message of the next send in wire order. read: the cache reads it. write: the send caches it for the next.
// tail: after the last point that caches, sent at the full price every time. change: how it differs from the last call.
// point: a point ends it, short when the prompt up to it is under the model's minimum and caches nothing.
export type ForecastPart = { role: Role; from: From; tokens: number; state: 'read' | 'write' | 'tail'; change: 'changed' | 'added' | null; point: 'cache' | 'short' | null };

// against: compared with the last call, null without one. removed: what the last call sent and the next does not.
// written: tokens the send caches anew; tail: those after its last caching point.
export type Forecast = {
  parts: ForecastPart[];
  removed: { role: Role; from: From; tokens: number }[];
  written: number;
  tail: number;
  against: CacheForecast | null;
};

type Change = Extract<CacheBreak, { from: From }> & { at: number };

const sums = (messages: WireMessage[]) => {
  let sum = 0;
  return messages.map(({ tokens }) => (sum += tokens));
};
// Without the id, which a print stored before it was kept lacks.
const place = (from: From) => JSON.stringify({ ...from, id: undefined });
const sameFrom = (a: WireMessage, b: WireMessage) => a.role === b.role && place(a.from) === place(b.from);

// Every message that differs from the last call's, in wire order, up to where the last call's cached prompt ends in
// the next send: what follows it there is the chat going on, not a change. One the next send has that the last call's
// cached prompt did not is changed when it stands in for a removed one from the same part, else added; one the last
// call cached that the next does not send is removed. A removed one sorts first at the same place.
function changes(before: WireMessage[], after: WireMessage[], same: number, end: number): Change[] {
  const cached = before.slice(same, end + 1);
  const had = new Set(cached.map(({ hash }) => hash));
  const at = new Map<string, number>();
  after.forEach(({ hash }, index) => {
    if (index >= same && !at.has(hash)) at.set(hash, index);
  });
  const gone = cached.flatMap((message, index) => (at.has(message.hash) ? [] : [{ message, at: same + index }]));
  const bound = Math.max(same + gone.length - 1, ...cached.flatMap(({ hash }) => at.get(hash) ?? []));
  const found: Change[] = [];
  for (let index = same; index <= bound && index < after.length; index++) {
    const message = after[index]!;
    if (had.has(message.hash)) continue;
    const pair = gone.findIndex((old) => sameFrom(old.message, message));
    if (pair !== -1) gone.splice(pair, 1);
    found.push({ kind: pair === -1 ? 'added' : 'changed', from: message.from, role: message.role, at: index });
  }
  for (const { message, at: index } of gone) found.push({ kind: 'removed', from: message.from, role: message.role, at: index });
  return found.sort((a, b) => a.at - b.at || (a.kind === 'removed' ? -1 : b.kind === 'removed' ? 1 : 0));
}

// A provider reads its cache only where a point of the last call stood, as far as both requests match from their
// start, and only from a point of the next send within its lookback after it. A point whose prompt is under the
// model's minimum caches nothing, so a last call none of whose points reach it is not compared. null when the next
// send marks no point and there is no last call to compare.
export function forecast(last: Prior | null, next: CacheSend): Forecast | null {
  const after = next.messages;
  const nextPoints = after.flatMap((message, index) => (message.point ? [index] : []));
  if (!last && !nextPoints.length) return null;
  const minimum = next.facts?.minimum ?? null;
  const lookback = next.facts?.lookback ?? null;
  const upTo = sums(after);
  const caches = (sum: number) => minimum === null || sum >= minimum;
  const writeEnd = nextPoints.findLast((point) => caches(upTo[point]!)) ?? -1;

  let readEnd = -1;
  let against: CacheForecast | null = null;
  let found: Change[] = [];
  const before = last?.print.messages ?? [];
  const had = sums(before);
  const points = before.flatMap((message, index) => (message.point && caches(had[index]!) ? [index] : []));
  if (last && points.length) {
    const of = had[points.at(-1)!]!;
    const none = (broken: CacheBreak): CacheForecast => ({ read: 0, of, broken });
    const { print } = last;
    if (!last.live) against = none({ kind: 'expired' });
    else if (next.connection !== print.connection || next.model !== print.model) against = none({ kind: 'model' });
    else if (print.account !== null && next.account !== null && next.account !== print.account) against = none({ kind: 'account' });
    else if (JSON.stringify(next.reasoning) !== JSON.stringify(print.reasoning)) against = none({ kind: 'reasoning' });
    else if (!nextPoints.length) against = none({ kind: 'off' });
    else {
      let same = 0;
      while (same < before.length && same < after.length && before[same]!.role === after[same]!.role && before[same]!.hash === after[same]!.hash) same++;
      const matched = points.filter((point) => point < same);
      readEnd = matched.findLast((point) => nextPoints.some((at) => at >= point && (lookback === null || at - point <= lookback))) ?? -1;
      found = changes(before, after, same, points.at(-1)!);
      const read = readEnd === -1 ? 0 : upTo[readEnd]!;
      const broken: CacheBreak | null = readEnd === points.at(-1) ? null : matched.at(-1) === points.at(-1) ? { kind: 'far' } : found[0] ? { kind: found[0].kind, from: found[0].from, role: found[0].role } : null;
      against = { read, of, broken };
    }
  }

  const changed = new Map(found.flatMap((change) => (change.kind === 'removed' ? [] : [[change.at, change.kind] as const])));
  const parts = after.map(({ role, from, tokens, point }, index): ForecastPart => ({
    role,
    from,
    tokens,
    state: index <= readEnd ? 'read' : index <= writeEnd ? 'write' : 'tail',
    change: changed.get(index) ?? null,
    point: point ? (caches(upTo[index]!) ? 'cache' : 'short') : null,
  }));
  const removed = found.flatMap((change) => (change.kind === 'removed' ? [{ role: change.role, from: change.from, tokens: before[change.at]!.tokens }] : []));
  const read = readEnd === -1 ? 0 : upTo[readEnd]!;
  const cached = writeEnd === -1 ? read : upTo[writeEnd]!;
  return { parts, removed, written: cached - read, tail: (upTo.at(-1) ?? 0) - cached, against };
}

// What the next send's input would cost as forecast, and had it read all the last call cached, from the model's
// price; null without one. Both write what the next send caches past what they read.
export function breakCost(connection: Connection, model: Model, { parts, written, against }: Forecast): { paid: Cost; whole: Cost } | null {
  if (!model.price || !against?.broken) return null;
  const inputTokens = parts.reduce((sum, { tokens }) => sum + tokens, 0);
  const unit = costUnit(resolveConnection(connection)?.type ?? null);
  const cost = (cached: number, write: number) => priceCost(model.price!, { inputTokens, outputTokens: 0, reasoningTokens: null, cachedInputTokens: cached, cacheWriteInputTokens: write }, unit);
  const ends = against.read + written;
  const paid = cost(against.read, written);
  const whole = cost(Math.min(against.of, ends), Math.max(ends - against.of, 0));
  return paid && whole && { paid, whole };
}
