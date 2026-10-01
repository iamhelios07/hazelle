import { describe, expect, it } from 'vitest';
import { branchTree, calls, chatTitle, fold, modelUsage, recentModels, shown, type ChatItem, type Entry, type Message, type Receipt } from './chat';
import type { Stored } from './kinds';

let rev = 0;
const entry = (id: string, value: Entry): Stored<'entry'> => ({ id, kind: 'entry', parent: 'chat', rev: ++rev, value });
const user = (id: string, text: string) => entry(id, { type: 'message', role: 'user', at: rev, text, receipt: null });
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
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
    // A select written before the edit, naming the replaced version, still lands on its slot.
    entries.push(entry('s1', { type: 'select', message: 'b1', version: 'v2', at: 0 }), entry('s2', { type: 'select', message: 'b1', version: 'b1', at: 0 }));
    expect(shown(fold(entries)[0]!).text).toBe('하나 고침');
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
  it('counts a branch’s copy once and each call of a continued reply, and keeps what was not reported apart', () => {
    const cut = receipt({ usage: { inputTokens: 100, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 50, reasoningTokens: null }, cost: { unit: 'usd', amount: 0.5, source: 'reported' }, totalMs: 500 });
    const continued = receipt({ continues: cut, cost: { unit: 'usd', amount: 0.25, source: 'price-list' } });
    const original = fold([bot('b1', '하나', continued), bot('b2', '둘', { model: 'm2' })]);
    const branch = fold([{ ...bot('b9', '하나', continued), rev: 99 }]);
    branch[0]!.versions[0]!.at = original[0]!.versions[0]!.at;
    expect(modelUsage([original, branch], { connection: 'c1', model: 'm1' })).toEqual({
      calls: 2,
      last: original[0]!.versions[0]!.at,
      input: { total: 100, unknown: 1 },
      output: { total: 50, unknown: 1 },
      costs: [{ unit: 'usd', amount: 0.75, estimated: true }],
      costUnknown: 0,
    });
  });
});

describe('modelUsage of translations', () => {
  it('counts a translation as a call of the model that made it, at the time it was made', () => {
    const translated = fold([bot('b1', 'Hello', { model: 'm2' }), entry('t1', { type: 'translation', version: 'b1', text: '안녕', receipt: receipt({ cost: { unit: 'usd', amount: 0.1, source: 'reported' } }), at: 5 })]);
    expect(modelUsage([translated], { connection: 'c1', model: 'm1' })).toMatchObject({ calls: 1, last: 5, costs: [{ unit: 'usd', amount: 0.1, estimated: false }] });
  });
});

describe('recentModels', () => {
  it('lists each model once, newest first', () => {
    const one = fold([bot('b1', 'a', { model: 'm1' }), bot('b2', 'b', { model: 'm2' })]);
    const two = fold([bot('b3', 'c', { model: 'm1' })]);
    expect(recentModels([one, two], 5)).toEqual([
      { connection: 'c1', model: 'm1' },
      { connection: 'c1', model: 'm2' },
    ]);
  });
});
