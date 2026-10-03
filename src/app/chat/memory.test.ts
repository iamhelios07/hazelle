import { describe, expect, it } from 'vitest';
import { factGroups, MessagePositions, spanOf } from './memory';

const source = (message: string) => ({ message, version: `${message}-v` });
const messages = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

describe('a record in the memory panel', () => {
  it('names its messages by their place now, counting the deleted ones apart', () => {
    const index = new MessagePositions();
    const positions = index.read(messages);
    expect(spanOf([source('b'), source('c')], positions)).toEqual({ words: '메시지 2–3', there: ['b', 'c'] });
    expect(spanOf([source('x'), source('d')], positions)).toEqual({ words: '4번째 메시지 · 지운 메시지 1개', there: ['d'] });
    expect(spanOf([source('x'), source('y')], positions)).toEqual({ words: '지운 메시지 2개', there: [] });
    expect(index.read(messages)).toBe(positions);
    expect(index.read(messages.map(({ id }) => ({ id, text: 'streamed text', version: 'changed' })))).toBe(positions);
    const reordered = index.read([{ id: 'd' }, { id: 'b' }, { id: 'e' }]);
    expect(reordered).not.toBe(positions);
    expect(spanOf([source('b'), source('c'), source('d')], reordered)).toEqual({ words: '메시지 1–2 · 지운 메시지 1개', there: ['b', 'd'] });
    const replaced = index.read([{ id: 'd' }, { id: 'b' }, { id: 'c' }]);
    expect(replaced).not.toBe(reordered);
    expect(spanOf([source('e'), source('c')], replaced)).toEqual({ words: '3번째 메시지 · 지운 메시지 1개', there: ['c'] });
  });

  it('groups the state by whom it concerns, in first appearance order', () => {
    const fact = (about: string, field: string) => ({ about, field, value: '', record: null });
    expect(factGroups([fact('하나', '나이'), fact('둘', '사는 곳'), fact('하나', '말투')]).map(({ about, facts }) => [about, facts.map(({ field }) => field)])).toEqual([
      ['하나', ['나이', '말투']],
      ['둘', ['사는 곳']],
    ]);
  });
});
