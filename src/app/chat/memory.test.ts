import { describe, expect, it } from 'vitest';
import { factGroups, spanOf } from './memory';

const source = (message: string) => ({ message, version: `${message}-v` });
const messages = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

describe('a record in the memory panel', () => {
  it('names its messages by their place now, counting the deleted ones apart', () => {
    expect(spanOf([source('b'), source('c')], messages)).toEqual({ words: '메시지 2–3', there: ['b', 'c'] });
    expect(spanOf([source('x'), source('d')], messages)).toEqual({ words: '4번째 메시지 · 지운 메시지 1개', there: ['d'] });
    expect(spanOf([source('x'), source('y')], messages)).toEqual({ words: '지운 메시지 2개', there: [] });
  });

  it('groups the state by whom it concerns, in first appearance order', () => {
    const fact = (about: string, field: string) => ({ about, field, value: '', record: null });
    expect(factGroups([fact('하나', '나이'), fact('둘', '사는 곳'), fact('하나', '말투')]).map(({ about, facts }) => [about, facts.map(({ field }) => field)])).toEqual([
      ['하나', ['나이', '말투']],
      ['둘', ['사는 곳']],
    ]);
  });
});
