import { describe, expect, it } from 'vitest';
import { chatItems, chatTitle, fold, recentModels, shown, type Entry, type Message, type Receipt } from './chat';
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
});

const asStored = (messages: Message[]) => messages.map((message) => shown(message).text);

describe('chatTitle', () => {
  it('uses the given title, then the first line of the first message', () => {
    const messages = fold([user('u1', '  기숙사 첫날\n둘째 줄')]);
    expect(chatTitle({ title: null, character: null, models: {} }, messages, asStored(messages))).toBe('기숙사 첫날');
    expect(chatTitle({ title: '이름', character: null, models: {} }, messages, asStored(messages))).toBe('이름');
    expect(chatTitle({ title: null, character: null, models: {} }, [], [])).toBe('새 채팅');
  });
});

describe('chatItems', () => {
  it('puts the chat written to last first, and a rename does not move it', () => {
    const chat = (id: string, at: number, title: string | null = null): Stored<'chat'> => ({ id, kind: 'chat', parent: null, rev: at, value: { title, character: null, models: {} } });
    const written = (at: number): Stored<'entry'> => ({ ...user(`u${at}`, '안녕'), rev: at });
    const entries: Record<string, Stored<'entry'>[]> = { a: [written(5)], renamed: [written(3)], empty: [] };
    const items = chatItems([chat('a', 1), chat('renamed', 10, '새 이름'), chat('empty', 7)], (id) => entries[id]!, (_, messages) => asStored(messages));
    expect(items.map((item) => [item.id, item.order])).toEqual([
      ['empty', 7],
      ['a', 5],
      ['renamed', 3],
    ]);
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
