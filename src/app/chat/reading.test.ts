import { describe, expect, it } from 'vitest';
import type { Reading } from '../ui';
import { parseReading } from './reading';

const FALLBACK: Reading = { font: 'serif', size: 17, leading: 'normal', width: 'normal', reply: 'follow' };

describe('stored reading settings', () => {
  it('keeps the known choices and starts each unknown or out-of-range field from the fallback', () => {
    const chosen: Reading = { font: 'sans', size: 21, leading: 'wide', width: 'narrow', reply: 'stay' };
    expect(parseReading(JSON.stringify(chosen), FALLBACK)).toEqual(chosen);
    expect(parseReading(JSON.stringify({ font: 'mono', size: 22, leading: 'wide' }), FALLBACK)).toEqual({ ...FALLBACK, leading: 'wide' });
    expect(parseReading('null', FALLBACK)).toEqual(FALLBACK);
  });

  it('reads reading settings stored before 답장이 올 때 as following the reply', () => {
    expect(parseReading(JSON.stringify({ font: 'sans', size: 17, leading: 'normal', width: 'normal' }), FALLBACK).reply).toBe('follow');
    expect(parseReading(JSON.stringify({ ...FALLBACK, reply: 'jump' }), FALLBACK).reply).toBe('follow');
  });
});
