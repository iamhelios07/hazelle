import { describe, expect, it } from 'vitest';
import { branchTree, calls, chatTitle, connectionUsage, fold, modelUsage, previewLine, recentIn, recentModels, shown, usageCalls, type ChatItem, type Entry, type Message, type Receipt } from './chat';
import type { Stored } from './kinds';

let rev = 0;
const entry = (id: string, value: Entry): Stored<'entry'> => ({ id, kind: 'entry', parent: 'chat', rev: ++rev, value });
const user = (id: string, text: string) => entry(id, { type: 'message', role: 'user', at: rev, text, receipt: null });
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
const version = (id: string, message: string, text: string, replaces: string | null = null) =>
  entry(id, { type: 'version', message, replaces, edit: false, at: rev, text, receipt: receipt() });

describe('fold', () => {
  it('orders by rev, not by the order entries arrive in', () => {
    const entries = [user('u1', '안녕'), bot('b1', '반가워')];
    expect(fold(entries.reverse()).map((message) => message.id)).toEqual(['u1', 'b1']);
  });

  it('shows a new version, and a select moves between versions', () => {
    const entries = [bot('b1', '하나'), version('v2', 'b1', '둘')];
    expect(shown(fold(entries)[0]!).text).toBe('둘');
    entries.push(entry('s1', { type: 'select', message: 'b1', version: 'b1', at: 0 }));
    expect(shown(fold(entries)[0]!).text).toBe('하나');
  });

  it('puts an edit or a retry in the place of the version it replaces', () => {
    const entries = [bot('b1', '하나'), version('v2', 'b1', '둘'), version('e1', 'b1', '하나 고침', 'b1')];
    const [message] = fold(entries);
    expect(message!.versions.map((v) => v.text)).toEqual(['하나 고침', '둘']);
    expect(message!.selected).toBe(0);
    entries.push(entry('s1', { type: 'select', message: 'b1', version: 'v2', at: 0 }), entry('s2', { type: 'select', message: 'b1', version: 'b1', at: 0 }));
    expect(shown(fold(entries)[0]!).text).toBe('하나 고침');
  });

  it('leads a version replaced more than once to the one standing in its place, for a device that still shows the first', () => {
    const twice = [user('m1', 'v0'), version('v1', 'm1', 'v1', 'm1'), version('v2', 'm1', 'v2', 'v1'), version('other', 'm1', 'other')];
    const selected = fold([...twice, entry('s1', { type: 'select', message: 'm1', version: 'm1', at: 0 })])[0]!;
    expect([selected.versions.map(({ text }) => text), selected.selected]).toEqual([['v2', 'other'], 0]);
    const edited = fold([...twice, version('v3', 'm1', 'v3', 'm1')])[0]!;
    expect([edited.versions.map(({ text }) => text), edited.selected]).toEqual([['v3', 'other'], 0]);
  });

  it('keeps a text past the scripts staged through its edit, never through a retry or a new version', () => {
    const edit = (id: string, replaces: string) => entry(id, { type: 'version', message: 'b1', replaces, edit: true, at: rev, text: '고침', receipt: null });
    const entries = [entry('b1', { type: 'message', role: 'assistant', at: rev, text: '하나', receipt: null, staged: true }), edit('e1', 'b1'), version('v2', 'b1', '둘'), edit('e2', 'v2')];
    expect(fold(entries)[0]!.versions.map((v) => v.staged)).toEqual([true, undefined]);
    expect(fold([...entries.slice(0, 1), version('r1', 'b1', '다시', 'b1')])[0]!.versions[0]!.staged).toBeUndefined();
  });

  it('gives a version the latest translation made of it, never one made of the version it replaced', () => {
    const made = (text: string) => ({ text, receipt: receipt(), at: rev });
    const entries = [bot('b1', 'Hello'), entry('t1', { type: 'translation', version: 'b1', ...made('안녕') }), entry('t2', { type: 'translation', version: 'b1', ...made('안녕하세요') })];
    expect(shown(fold(entries)[0]!).translation?.text).toBe('안녕하세요');
    entries.push(version('b2', 'b1', 'Hi', 'b1'), entry('t3', { type: 'translation', version: 'b1', ...made('늦은 번역') }));
    expect(shown(fold(entries)[0]!).translation).toBeUndefined();
  });

  it('hides a deleted message until it is restored', () => {
    const entries = [user('u1', '안녕'), entry('d1', { type: 'delete', message: 'u1', at: 0 })];
    expect(fold(entries)).toEqual([]);
    entries.push(entry('r1', { type: 'restore', message: 'u1', at: 0 }));
    expect(fold(entries).map((message) => message.id)).toEqual(['u1']);
  });

  it('settles a pending cost from a later cost entry', () => {
    const entries = [bot('b1', '답', { cost: 'pending', replyId: 'gen_1' })];
    expect(shown(fold(entries)[0]!).receipt!.cost).toBe('pending');
    entries.push(entry('k1', { type: 'cost', replyId: 'gen_1', cost: { unit: 'usd', amount: 0.01, source: 'reported' }, at: 0 }));
    expect(shown(fold(entries)[0]!).receipt!.cost).toEqual({ unit: 'usd', amount: 0.01, source: 'reported' });
  });

  it('settles the pending cost of a cut call a continued version carries, and keeps both calls', () => {
    const cut = receipt({ state: 'cut', cut: 'length', cost: 'pending', replyId: 'gen_1' });
    const entries = [
      entry('b1', { type: 'message', role: 'assistant', at: 0, text: '옛날', receipt: cut }),
      entry('c1', { type: 'version', message: 'b1', replaces: 'b1', edit: false, at: 0, text: '옛날 옛적에', receipt: receipt({ continues: cut }) }),
      entry('k1', { type: 'cost', replyId: 'gen_1', cost: { unit: 'usd', amount: 0.01, source: 'reported' }, at: 0 }),
    ];
    const [message] = fold(entries);
    expect(message!.versions).toHaveLength(1);
    expect(calls(shown(message!).receipt!).map((call) => [call.state, call.cost])).toEqual([
      ['cut', { unit: 'usd', amount: 0.01, source: 'reported' }],
      ['done', null],
    ]);
  });
});

describe("fold with the bot's Lua writes", () => {
  it('keeps them with a version through its edits, and leaves them behind on a retry', () => {
    const edit = (id: string, replaces: string, before?: [string, string][]) => entry(id, { type: 'version', message: 'b1', replaces, edit: true, at: rev, text: id, receipt: receipt(), ...(before && { before }) });
    const entries = [
      entry('b1', { type: 'message', role: 'assistant', at: rev, text: '하나', receipt: receipt(), before: [['turn', '1']] }),
      entry('w1', { type: 'vars', version: 'b1', set: [['hp', '9']], at: rev }),
      edit('e1', 'b1', [['mood', 'calm']]),
      entry('w2', { type: 'vars', version: 'b1', set: [['hp', '8']], at: rev }),
      edit('e2', 'e1'),
      entry('w3', { type: 'vars', version: 'e1', set: [['hp', '7']], at: rev }),
    ];
    expect(shown(fold(entries)[0]!)).toMatchObject({ id: 'e2', before: [['turn', '1'], ['mood', 'calm']], after: [['hp', '9'], ['hp', '8'], ['hp', '7']] });
    const retried = shown(fold([...entries, version('r1', 'b1', '다시', 'e2')])[0]!);
    expect([retried.before, retried.after]).toEqual([undefined, undefined]);
  });

  it('keeps what a button wrote with its message whichever version is shown, and with the message before once its own is deleted', () => {
    const entries = [user('u1', '안녕'), bot('b1', '하나'), entry('w1', { type: 'vars', version: 'b1', set: [['door', 'open']], at: rev, stays: true }), version('v2', 'b1', '둘')];
    expect(fold(entries)[1]).toMatchObject({ after: [['door', 'open']] });
    expect(shown(fold(entries)[1]!).after).toBeUndefined();
    const [left] = fold([...entries, entry('d1', { type: 'delete', message: 'b1', at: rev })]);
    expect(left).toMatchObject({ id: 'u1', after: [['door', 'open']] });
  });
});

const asStored = (messages: Message[]) => messages.map((message) => shown(message).text);

describe('chatTitle', () => {
  it('uses the given title, then a branch its origin, then the first line of the first message', () => {
    const messages = fold([user('u1', '  기숙사 첫날\n둘째 줄')]);
    expect(chatTitle({ title: null, character: null, models: {} }, messages, asStored(messages))).toBe('기숙사 첫날');
    expect(chatTitle({ title: '이름', character: null, models: {} }, messages, asStored(messages))).toBe('이름');
    expect(chatTitle({ title: null, character: null, models: {}, origin: { id: 'a', name: '기숙사의 밤', after: 'u1' } }, messages, asStored(messages))).toBe('기숙사의 밤 · 갈래');
    expect(chatTitle({ title: null, character: null, models: {} }, [], [])).toBe('새 채팅');
  });
});

describe('branchTree', () => {
  it('puts each branch under the chat it came from, and one whose origin is gone at the top', () => {
    const item = (id: string, origin?: string): ChatItem => ({
      id,
      chat: { title: null, character: null, models: {}, ...(origin && { origin: { id: origin, name: origin, after: 'm' } }) },
      messages: [],
      count: 0,
      title: id,
      preview: '',
      at: null,
      order: 0,
    });
    const tree = branchTree([item('b1', 'a'), item('c'), item('orphan', 'deleted'), item('a'), item('b2', 'b1')]);
    expect(tree.map(({ item, nested }) => [item.id, nested])).toEqual([
      ['c', false],
      ['orphan', false],
      ['a', false],
      ['b1', true],
      ['b2', true],
    ]);
  });
});

describe('modelUsage', () => {
  it('keeps the booked cost when an explicitly walked branch precedes the original that settled it', () => {
    const original = fold([bot('original', 'reply', receipt({ cost: { unit: 'usd', amount: 0.5, source: 'reported' } }))]);
    const branch = structuredClone(original);
    branch[0]!.versions[0]!.receipt!.cost = 'pending';
    expect(modelUsage([branch, original].map(usageCalls), { connection: 'c1', model: 'm1' })).toMatchObject({ calls: 1, costUnknown: 0, costs: [{ unit: 'usd', amount: 0.5, estimated: false }] });
  });

  it('counts a branch’s copy once and each call of a continued reply, and keeps what was not reported apart', () => {
    const cut = receipt({ usage: { inputTokens: 100, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 50, reasoningTokens: null }, cost: { unit: 'usd', amount: 0.5, source: 'reported' }, totalMs: 500 });
    const continued = receipt({ continues: cut, cost: { unit: 'usd', amount: 0.25, source: 'price-list' } });
    const original = fold([bot('b1', '하나', continued), bot('b2', '둘', { model: 'm2' })]);
    const branch = fold([{ ...bot('b9', '하나', continued), rev: 99 }]);
    branch[0]!.versions[0]!.at = original[0]!.versions[0]!.at;
    expect(modelUsage([original, branch].map(usageCalls), { connection: 'c1', model: 'm1' })).toEqual({
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
    expect(modelUsage([original, branch].map(usageCalls), { connection: 'c1', model: 'm1' })).toMatchObject({ calls: 2 });
  });
});

describe('modelUsage of translations', () => {
  it('counts a translation as a call of the model that made it, at the time it was made', () => {
    const translated = fold([bot('b1', 'Hello', { model: 'm2' }), entry('t1', { type: 'translation', version: 'b1', text: '안녕', receipt: receipt({ cost: { unit: 'usd', amount: 0.1, source: 'reported' } }), at: 5 })]);
    expect(modelUsage([translated].map(usageCalls), { connection: 'c1', model: 'm1' })).toMatchObject({ calls: 1, last: 5, costs: [{ unit: 'usd', amount: 0.1, estimated: false }] });
  });
});

describe('connectionUsage', () => {
  it('counts one connection’s calls over the last hour, today and this week from Monday, a branch’s copy once', () => {
    const now = new Date(2026, 9, 7, 12, 30).getTime(); // a Wednesday
    const call = (id: string, at: number, connection = 'c1') => ({ at, call: { id, connection, model: 'm1', usage: { inputTokens: 10, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 5, reasoningTokens: null }, cost: null } });
    const recent = call('recent', now - 60_000);
    const original = [recent, call('morning', new Date(2026, 9, 7, 0, 0).getTime()), call('monday', new Date(2026, 9, 5, 0, 0).getTime()), call('sunday', new Date(2026, 9, 4, 23, 59).getTime()), call('other', now, 'c2')];
    const usage = connectionUsage([original, [recent]], 'c1', now);
    expect([usage.hour.calls, usage.today.calls, usage.week.calls]).toEqual([1, 2, 3]);
    expect(usage.week).toMatchObject({ input: { total: 30, unknown: 0 }, output: { total: 15, unknown: 0 }, costUnknown: 3 });
  });
});

describe('recentModels', () => {
  it('lists each model once, newest first', () => {
    const one = fold([bot('b1', 'a', { model: 'm1' }), bot('b2', 'b', { model: 'm2' })]);
    const two = fold([bot('b3', 'c', { model: 'm1' })]);
    expect(recentModels([recentIn(one), recentIn(two)], 5)).toEqual([
      { connection: 'c1', model: 'm1' },
      { connection: 'c1', model: 'm2' },
    ]);
  });
});

describe('previewLine', () => {
  it('passes a status line for the first line of prose, and keeps a message that is all status', () => {
    expect(previewLine('⏱️[2025-03-15 (토요일) 오후 05:36]\n\n"으응..." 그녀가 눈을 떴다.')).toBe('"으응..." 그녀가 눈을 떴다.');
    expect(previewLine('# Response\n<div>The moment Steve called</div>')).toBe('The moment Steve called');
    expect(previewLine('[HP 3/10]\n---')).toBe('[HP 3/10]');
  });
});
