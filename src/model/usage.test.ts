import { describe, expect, it } from 'vitest';
import { fold, usageCall, usageCalls, type Entry, type Message, type Receipt } from './chat';
import { connectionUsage, modelUsage, usageReport, windowStart } from './usage';
import type { Stored } from './kinds';

let rev = 0;
const entry = (id: string, value: Entry): Stored<'entry'> => ({ id, kind: 'entry', parent: 'chat', rev: ++rev, value });
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: crypto.randomUUID(),
  connection: 'c1',
  source: 'OpenRouter',
  model: 'm1',
  modelName: 'Model One',
  state: 'done',
  cut: null,
  error: null,
  finishReason: 'stop',
  usage: null,
  cost: null,
  replyId: null,
  firstTextMs: 100,
  totalMs: 900,
  cache: null,
  ...over,
});
const bot = (id: string, text: string, over?: Partial<Receipt>) =>
  entry(id, { type: 'message', role: 'assistant', at: rev, text, receipt: receipt(over) });

const held = (messages: Message[]) => ({ calls: usageCalls(messages) });

describe('modelUsage', () => {
  it('replaces a copied price-list cost with a later reported cost for the same call', () => {
    const estimated = usageCall(receipt({ id: 'shared', cost: { unit: 'usd', amount: 0.5, source: 'price-list' } }), 10);
    const reported = { ...estimated, call: { ...estimated.call, cost: { unit: 'usd' as const, amount: 0.25, source: 'reported' as const } } };
    expect(modelUsage([{ calls: [estimated] }, { calls: [reported] }], { connection: 'c1', model: 'm1' })).toEqual({
      calls: 1,
      last: 10,
      input: { total: 0, unknown: 1 },
      output: { total: 0, unknown: 1 },
      costs: [{ unit: 'usd', amount: 0.25, estimated: false }],
      costUnknown: 0,
    });
  });

  it('sums costs separately by unit, marking only the unit with a price-list cost as estimated', () => {
    const calls = [
      usageCall(receipt({ cost: { unit: 'usd', amount: 0.5, source: 'reported' } }), 10),
      usageCall(receipt({ cost: { unit: 'credit', amount: 2, source: 'price-list' } }), 11),
      usageCall(receipt({ cost: { unit: 'usd', amount: 0.25, source: 'reported' } }), 12),
      usageCall(receipt({ cost: { unit: 'credit', amount: 3, source: 'reported' } }), 13),
    ];
    expect(modelUsage([{ calls }], { connection: 'c1', model: 'm1' })).toMatchObject({
      calls: 4,
      costs: [{ unit: 'usd', amount: 0.75, estimated: false }, { unit: 'credit', amount: 5, estimated: true }],
      costUnknown: 0,
    });
  });

  it('keeps the booked cost when an explicitly walked branch precedes the original that settled it', () => {
    const original = fold([bot('original', 'reply', receipt({ cost: { unit: 'usd', amount: 0.5, source: 'reported' } }))]);
    const branch = structuredClone(original);
    branch[0]!.versions[0]!.receipt!.cost = 'pending';
    expect(modelUsage([branch, original].map(held), { connection: 'c1', model: 'm1' })).toMatchObject({ calls: 1, costUnknown: 0, costs: [{ unit: 'usd', amount: 0.5, estimated: false }] });
  });

  it('counts a branch’s copy once and each call of a continued reply, and keeps what was not reported apart', () => {
    const cut = receipt({ usage: { inputTokens: 100, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 50, reasoningTokens: null }, cost: { unit: 'usd', amount: 0.5, source: 'reported' }, totalMs: 500 });
    const continued = receipt({ continues: cut, cost: { unit: 'usd', amount: 0.25, source: 'price-list' } });
    const original = fold([bot('b1', '하나', continued), bot('b2', '둘', { model: 'm2' })]);
    const branch = fold([{ ...bot('b9', '하나', continued), rev: 99 }]);
    branch[0]!.versions[0]!.at = original[0]!.versions[0]!.at;
    expect(modelUsage([original, branch].map(held), { connection: 'c1', model: 'm1' })).toEqual({
      calls: 2,
      last: original[0]!.versions[0]!.at,
      input: { total: 100, unknown: 1 },
      output: { total: 50, unknown: 1 },
      costs: [{ unit: 'usd', amount: 0.75, estimated: true }],
      costUnknown: 0,
    });
  });
});

describe('modelUsage of a call held twice', () => {
  it('counts it once though a branch holds it under a later edit and the original has continued it since', () => {
    const cut = receipt({ state: 'cut', cut: 'length' });
    const original = fold([bot('b1', '하나 둘', { continues: cut })]);
    const branch = fold([bot('b9', '하나', cut), entry('e9', { type: 'version', message: 'b9', replaces: 'b9', edit: true, at: 999, text: '하나.', receipt: cut })]);
    expect(modelUsage([original, branch].map(held), { connection: 'c1', model: 'm1' })).toMatchObject({ calls: 2 });
  });
});

describe('modelUsage of translations', () => {
  it('counts a translation as a call of the model that made it, at the time it was made', () => {
    const translated = fold([bot('b1', 'Hello', { model: 'm2' }), entry('t1', { type: 'translation', version: 'b1', text: '안녕', receipt: receipt({ cost: { unit: 'usd', amount: 0.1, source: 'reported' } }), at: 5 })]);
    expect(modelUsage([translated].map(held), { connection: 'c1', model: 'm1' })).toMatchObject({ calls: 1, last: 5, costs: [{ unit: 'usd', amount: 0.1, estimated: false }] });
  });
});

describe('connectionUsage', () => {
  it('counts one connection’s calls over the last hour, today and this week from Monday, a branch’s copy once', () => {
    const now = new Date(2026, 9, 7, 12, 30).getTime(); // a Wednesday
    const call = (id: string, at: number, connection = 'c1') => ({ at, call: { id, connection, model: 'm1', modelName: 'm1', source: connection, usage: { inputTokens: 10, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 5, reasoningTokens: null }, cost: null } });
    const recent = call('recent', now - 60_000);
    const original = [recent, call('morning', new Date(2026, 9, 7, 0, 0).getTime()), call('monday', new Date(2026, 9, 5, 0, 0).getTime()), call('sunday', new Date(2026, 9, 4, 23, 59).getTime()), call('other', now, 'c2')];
    const usage = connectionUsage([{ calls: original }, { calls: [recent] }], 'c1', now);
    expect([usage.hour.calls, usage.today.calls, usage.week.calls]).toEqual([1, 2, 3]);
    expect(usage.week).toMatchObject({ input: { total: 30, unknown: 0 }, output: { total: 15, unknown: 0 }, costUnknown: 3 });
  });
});

describe('usageReport', () => {
  it('counts each call once by day, model, character and chat, a branch’s copy under the chat it was made in', () => {
    const on = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
    const call = (id: string, at: number, model = 'm1') => ({ at, call: { id, connection: 'c1', model, modelName: model.toUpperCase(), source: 'C1', usage: null, cost: null } });
    const shared = call('shared', on(13));
    const report = usageReport([
      { chat: 'branch', character: 'k1', branch: true, calls: [shared, call('b', on(14), 'm2')] },
      { chat: 'origin', character: 'k1', calls: [shared, call('o', on(14, 9))] },
      { character: 'k2', calls: [call('profile', on(14))] },
      { chat: 'old', character: null, calls: [call('old', on(1))] },
    ], 'week', on(14, 18)); // a Wednesday
    expect(report.total.calls).toBe(4);
    expect(report.periods.map(({ key, usage }) => [key, usage.calls])).toEqual([[on(12, 0), 0], [on(13, 0), 1], [on(14, 0), 3], [on(15, 0), 0], [on(16, 0), 0], [on(17, 0), 0], [on(18, 0), 0]]);
    expect(report.models.map(({ model, modelName, usage }) => [model, modelName, usage.calls])).toEqual([['m1', 'M1', 3], ['m2', 'M2', 1]]);
    expect(report.characters.map(({ key, usage }) => [key, usage.calls])).toEqual([['k1', 3], ['k2', 1]]);
    expect(report.chats.map(({ key, usage }) => [key, usage.calls])).toEqual([['origin', 2], ['branch', 1]]);
  });

  it('runs over all time a month at a time from the first call’s, an empty month too', () => {
    const call = (id: string, at: number) => ({ at, call: { id, connection: 'c1', model: 'm1', modelName: 'm1', source: 'C1', usage: null, cost: null } });
    const report = usageReport([{ calls: [call('august', new Date(2026, 7, 30).getTime()), call('october', new Date(2026, 9, 2).getTime())] }], 'all', new Date(2026, 9, 7).getTime());
    expect(report.periods.map(({ key, usage }) => [key, usage.calls])).toEqual([[new Date(2026, 7, 1).getTime(), 1], [new Date(2026, 8, 1).getTime(), 0], [new Date(2026, 9, 1).getTime(), 1]]);
  });

  it('starts the month at its first day’s local midnight', () => {
    expect(windowStart('month', new Date(2026, 9, 7, 12, 30).getTime())).toBe(new Date(2026, 9, 1).getTime());
  });
});

