import { describe, expect, it } from 'vitest';
import { readTyped } from './typedNumber';

describe('readTyped', () => {
  it('reads a number and words each way it can be wrong', () => {
    expect(readTyped('0.7', false)).toEqual({ ok: true, value: 0.7 });
    expect(readTyped('abc', false)).toEqual({ ok: false, error: '숫자를 적어 주세요.' });
    expect(readTyped('1.5', true)).toEqual({ ok: false, error: '정수로 적어 주세요.' });
  });
});
