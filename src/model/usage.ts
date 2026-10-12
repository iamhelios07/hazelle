import type { ModelRef } from '../connectors/assignment';
import type { Cost } from '../connectors/types';
import type { Receipt } from './chat';

type Tally = { total: number; unknown: number };
// A count sums the calls that reported it, and unknown counts those that did not, so a gap never shrinks the total.
// costs: one per unit, never summed together; estimated once any part came from a price list.
export type ModelUsage = { calls: number; last: number | null; input: Tally; output: Tally; costs: { unit: Cost['unit']; amount: number; estimated: boolean }[]; costUnknown: number };

// modelName and source: the names when the call was made, for a model or connection renamed or deleted since.
export type UsageCall = { at: number; call: Pick<Receipt, 'id' | 'connection' | 'model' | 'modelName' | 'source' | 'usage' | 'cost'> };

// The calls one place holds: a chat, with its character and whether it is a branch, or a pack's 삽화 profile, which no
// chat holds.
export type UsageHeld = { calls: Iterable<UsageCall>; chat?: string; character?: string | null; branch?: boolean };

type Once<H> = { one: UsageCall; from: H };

// Every call once, by its id, however many places hold it, since a branch copies the replies it holds with their
// receipts. The cost is read from whichever copy has settled it, as the original settles later than a copy made after,
// and the call is the first holder's that is not a branch, where it was made.
function callsOnce<H extends UsageHeld>(held: Iterable<H>): Once<H>[] {
  const once = new Map<string, Once<H>>();
  const settled = ({ call }: UsageCall) => (call.cost === 'pending' ? null : call.cost);
  for (const from of held) {
    for (const one of from.calls) {
      const seen = once.get(one.call.id);
      if (!seen) {
        once.set(one.call.id, { one, from });
        continue;
      }
      const cost = settled(one);
      const previous = settled(seen.one);
      if (cost && (!previous || (previous.source === 'price-list' && cost.source === 'reported'))) seen.one = { at: seen.one.at, call: { ...seen.one.call, cost } };
      if (seen.from.branch && !from.branch) seen.from = from;
    }
  }
  return [...once.values()];
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

export const modelUsage = (held: Iterable<UsageHeld>, { connection, model }: ModelRef) =>
  sum(callsOnce(held).flatMap(({ one }) => (one.call.connection === connection && one.call.model === model ? [one] : [])));

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

export function connectionUsage(held: Iterable<UsageHeld>, connection: string, now: number): Record<'hour' | 'today' | 'week', ModelUsage> {
  const made = callsOnce(held).flatMap(({ one }) => (one.call.connection === connection ? [one] : []));
  const since = (window: UsageWindow) => sum(made.filter(({ at }) => at >= windowStart(window, now)));
  return { hour: since('hour'), today: since('today'), week: since('week') };
}

export type UsageGroup<K> = { key: K; usage: ModelUsage };
export type ModelGroup = UsageGroup<string> & Pick<UsageCall['call'], 'connection' | 'model' | 'modelName' | 'source'>;
export type ReportWindow = Exclude<UsageWindow, 'hour'> | 'all';

// periods: oldest first, every day of the window to its last, days to come too, or over all time every month from the
// first call's to this one, keyed by its local start, an empty one too. The other axes busiest first. A call no chat holds (a 삽화 profile's) counts under its
// character and in no chat.
export type UsageReport = { total: ModelUsage; periods: UsageGroup<number>[]; models: ModelGroup[]; characters: UsageGroup<string | null>[]; chats: UsageGroup<string>[] };

export function usageReport(held: Iterable<UsageHeld>, window: ReportWindow, now: number): UsageReport {
  const since = window === 'all' ? null : windowStart(window, now);
  const counted = callsOnce(held).filter(({ one }) => since === null || one.at >= since);
  const group = <K>(keyOf: (once: Once<UsageHeld>) => K | undefined): UsageGroup<K>[] => {
    const groups = new Map<K, UsageCall[]>();
    for (const once of counted) {
      const key = keyOf(once);
      if (key === undefined) continue;
      const calls = groups.get(key);
      if (calls) calls.push(once.one);
      else groups.set(key, [once.one]);
    }
    return [...groups].map(([key, calls]) => ({ key, usage: sum(calls) })).sort((a, b) => b.usage.calls - a.usage.calls);
  };
  const monthly = window === 'all';
  const startOf = (at: number) => {
    const start = new Date(at);
    start.setHours(0, 0, 0, 0);
    if (monthly) start.setDate(1);
    return start.getTime();
  };
  const made = new Map(group(({ one }) => startOf(one.at)).map(({ key, usage }) => [key, usage]));
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
  for (const { one } of counted) if ((named.get(modelKey(one))?.at ?? -Infinity) <= one.at) named.set(modelKey(one), one);
  return {
    total: sum(counted.map(({ one }) => one)),
    periods,
    models: group(({ one }) => modelKey(one)).map((entry) => {
      const { connection, model, modelName, source } = named.get(entry.key)!.call;
      return { ...entry, connection, model, modelName, source };
    }),
    characters: group(({ from }) => from.character ?? null),
    chats: group(({ from }) => from.chat),
  };
}

