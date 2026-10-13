import type { ModelRef } from '../connectors/assignment';
import type { Cost } from '../connectors/types';
import type { Receipt } from './chat';

type Tally = { total: number; unknown: number };
// A count sums the calls that reported it, and unknown counts those that did not, so a gap never shrinks the total.
// costs: one per unit, never summed together; estimated once any part came from a price list.
export type ModelUsage = { calls: number; last: number | null; input: Tally; output: Tally; costs: { unit: Cost['unit']; amount: number; estimated: boolean }[]; costUnknown: number };

// modelName and source: the names when the call was made, for a model or connection renamed or deleted since.
export type UsageCall = { at: number; call: Pick<Receipt, 'id' | 'connection' | 'model' | 'modelName' | 'source' | 'usage' | 'cost'> };

// The account's record of its model calls (kind ledger), one row per call written where the call was made or first
// saved, with where it was made; it outlives the chat. Rows are written once, so a cost booked after the call is a row
// of its own naming it. chat null: a call no chat made (번역기, a card's text, a 삽화 profile).
export type Ledger =
  | { type: 'call'; at: number; call: UsageCall['call']; chat: string | null; character: string | null }
  | { type: 'cost'; call: string; cost: Cost | null; at: number };

export type Counted = UsageCall & Pick<Extract<Ledger, { type: 'call' }>, 'chat' | 'character'>;

// Each call with the cost booked for it, when it was pending; a booked cost that is known wins over one that is not,
// since two devices may both look it up.
export function counted(rows: Iterable<Ledger>): Counted[] {
  const calls = new Map<string, Counted>();
  const booked = new Map<string, Cost | null>();
  for (const row of rows) {
    if (row.type === 'call') calls.set(row.call.id, { at: row.at, call: row.call, chat: row.chat, character: row.character });
    else if (!booked.get(row.call)) booked.set(row.call, row.cost);
  }
  return [...calls.values()].map((one) => (one.call.cost === 'pending' && booked.has(one.call.id) ? { ...one, call: { ...one.call, cost: booked.get(one.call.id)! } } : one));
}

function sum(made: Iterable<UsageCall>): ModelUsage {
  const usage: ModelUsage = { calls: 0, last: null, input: { total: 0, unknown: 0 }, output: { total: 0, unknown: 0 }, costs: [], costUnknown: 0 };
  const add = (tally: Tally, value: number | null) => (value === null ? tally.unknown++ : (tally.total += value));
  for (const { at, call } of made) {
    usage.calls++;
    usage.last = Math.max(usage.last ?? 0, at);
    add(usage.input, call.usage?.inputTokens ?? null);
    add(usage.output, call.usage?.outputTokens ?? null);
    const cost = call.cost === 'pending' ? null : call.cost;
    if (!cost) {
      usage.costUnknown++;
      continue;
    }
    const kept = usage.costs.find((entry) => entry.unit === cost.unit);
    if (kept) {
      kept.amount += cost.amount;
      kept.estimated ||= cost.source === 'price-list';
    } else usage.costs.push({ unit: cost.unit, amount: cost.amount, estimated: cost.source === 'price-list' });
  }
  return usage;
}

export const modelUsage = (calls: Counted[], { connection, model }: ModelRef) =>
  sum(calls.filter(({ call }) => call.connection === connection && call.model === model));

export type UsageWindow = 'hour' | 'today' | 'week' | 'month';

// In local time: today from midnight, the week from Monday's midnight, the month from its first day's.
export function windowStart(window: UsageWindow, now: number): number {
  if (window === 'hour') return now - 3_600_000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (window === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (window === 'month') start.setDate(1);
  return start.getTime();
}

export function connectionUsage(calls: Counted[], connection: string, now: number): Record<'hour' | 'today' | 'week', ModelUsage> {
  const made = calls.filter(({ call }) => call.connection === connection);
  const since = (window: UsageWindow) => sum(made.filter(({ at }) => at >= windowStart(window, now)));
  return { hour: since('hour'), today: since('today'), week: since('week') };
}

export type UsageGroup<K> = { key: K; usage: ModelUsage };
export type ModelGroup = UsageGroup<string> & Pick<UsageCall['call'], 'connection' | 'model' | 'modelName' | 'source'>;
export type ReportWindow = Exclude<UsageWindow, 'hour'> | 'all';
// A chat or character no longer kept counts under one group of its own, not one per id.
export const GONE = 'gone';
export type Kept = { chat: (id: string) => boolean; character: (id: string) => boolean };

// periods: oldest first, every day of the window to its last, days to come too, or over all time every month from the
// first call's to this one, keyed by its local start, an empty one too. The other axes busiest first. chats: null for
// the calls no chat made; characters: null for those of no character.
export type UsageReport = { total: ModelUsage; periods: UsageGroup<number>[]; models: ModelGroup[]; characters: UsageGroup<string | null>[]; chats: UsageGroup<string | null>[] };

export function usageReport(calls: Counted[], window: ReportWindow, now: number, kept: Kept): UsageReport {
  const since = window === 'all' ? null : windowStart(window, now);
  const shown = calls.filter(({ at }) => since === null || at >= since);
  const group = <K>(keyOf: (one: Counted) => K): UsageGroup<K>[] => {
    const groups = new Map<K, UsageCall[]>();
    for (const one of shown) {
      const key = keyOf(one);
      const held = groups.get(key);
      if (held) held.push(one);
      else groups.set(key, [one]);
    }
    return [...groups].map(([key, made]) => ({ key, usage: sum(made) })).sort((a, b) => b.usage.calls - a.usage.calls);
  };
  const monthly = window === 'all';
  const startOf = (at: number) => {
    const start = new Date(at);
    start.setHours(0, 0, 0, 0);
    if (monthly) start.setDate(1);
    return start.getTime();
  };
  const made = new Map(group(({ at }) => startOf(at)).map(({ key, usage }) => [key, usage]));
  const periods: UsageGroup<number>[] = [];
  const first = since ?? Math.min(now, ...made.keys());
  const last = new Date(startOf(now));
  if (window === 'week') last.setDate(last.getDate() + 6 - ((last.getDay() + 6) % 7));
  if (window === 'month') last.setMonth(last.getMonth() + 1, 0);
  for (const day = new Date(startOf(first)); day <= last; monthly ? day.setMonth(day.getMonth() + 1) : day.setDate(day.getDate() + 1)) {
    periods.push({ key: day.getTime(), usage: made.get(day.getTime()) ?? sum([]) });
  }
  const named = new Map<string, UsageCall>();
  const modelKey = ({ call }: UsageCall) => `${call.connection}\n${call.model}`;
  for (const one of shown) if ((named.get(modelKey(one))?.at ?? -Infinity) <= one.at) named.set(modelKey(one), one);
  return {
    total: sum(shown),
    periods,
    models: group(modelKey).map((entry) => {
      const { connection, model, modelName, source } = named.get(entry.key)!.call;
      return { ...entry, connection, model, modelName, source };
    }),
    characters: group(({ character }) => (character === null || kept.character(character) ? character : GONE)),
    chats: group(({ chat }) => (chat === null || kept.chat(chat) ? chat : GONE)),
  };
}
