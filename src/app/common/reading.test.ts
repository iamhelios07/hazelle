import { describe, expect, it } from 'vitest';
import type { Reading } from '../ui';
import { DISPLAY_DEFAULT, parseDisplay, parseReading, presetOf, presets } from './reading';

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

describe('stored display settings', () => {
  it('keeps a known theme and real switches, and starts anything else from the fallback', () => {
    const chosen = { theme: 'light', hideHeader: false, foldComposer: true } as const;
    expect(parseDisplay(JSON.stringify(chosen), DISPLAY_DEFAULT)).toEqual(chosen);
    expect(parseDisplay(JSON.stringify({ theme: 'sepia', hideHeader: 'no' }), DISPLAY_DEFAULT)).toEqual(DISPLAY_DEFAULT);
  });
});

describe('the current preset', () => {
  it('is the one whose every look value matches, whatever 답장이 올 때 and the chrome switches say', () => {
    const list = presets(FALLBACK);
    expect(presetOf(list, { ...FALLBACK, reply: 'stay' }, { ...DISPLAY_DEFAULT, hideHeader: false })?.name).toBe('기본');
    expect(presetOf(list, FALLBACK, { ...DISPLAY_DEFAULT, theme: 'light' })?.name).toBe('밝은 서재');
    expect(presetOf(list, { ...FALLBACK, size: 16 }, DISPLAY_DEFAULT)).toBeUndefined();
  });
});
