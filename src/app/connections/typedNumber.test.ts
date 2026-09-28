import { describe, expect, it } from 'vitest';
import { clamp, readTyped } from './typedNumber';

const within = (min: number | null, max: number | null, whole: boolean) => (value: number) =>
  (!whole || Number.isSafeInteger(value)) && (min === null || value >= min) && (max === null || value <= max);

describe('readTyped', () => {
  it('reads a number in range and words each way it can be wrong', () => {
    const temperature = { min: 0, max: 2, whole: false };
    expect(readTyped('0.7', temperature, within(0, 2, false))).toEqual({ ok: true, value: 0.7 });
    expect(readTyped(' ', temperature, within(0, 2, false))).toEqual({ ok: false, error: '숫자를 적어 주세요.' });
    expect(readTyped('3', temperature, within(0, 2, false))).toEqual({ ok: false, error: '0 ~ 2 사이로 적어 주세요.' });
    const reply = { min: 1, max: 64000, whole: true };
    expect(readTyped('1.5', reply, within(1, 64000, true), true)).toEqual({ ok: false, error: '정수로 적어 주세요.' });
    expect(readTyped('70000', reply, within(1, 64000, true), true)).toEqual({ ok: false, error: '이 모델은 64,000까지예요.' });
    expect(readTyped('-1', { min: 0, max: null, whole: true }, within(0, null, true))).toEqual({ ok: false, error: '0 이상으로 적어 주세요.' });
  });

  it('clamps a start value into the bounds', () => {
    expect(clamp(4000, { min: 1, max: 1024 })).toBe(1024);
    expect(clamp(1.05, { min: null, max: null })).toBe(1.05);
  });
});
