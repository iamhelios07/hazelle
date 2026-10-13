import { describe, expect, it } from 'vitest';
import type { Reading } from '../ui';
import { DISPLAY_DEFAULT, lookOf, parseDisplay, parseReading, presetOf, presets, savedPresets } from './reading';

const FALLBACK: Reading = { font: 'serif', size: 17, leading: 'normal', width: 'normal', reply: 'follow' };

describe('stored reading settings', () => {
  it('keeps the known choices and starts each unknown or out-of-range field from the fallback', () => {
    const chosen: Reading = { font: 'sans', size: 21, leading: 'wide', width: 'narrow', reply: 'stay' };
    expect(parseReading(JSON.stringify(chosen), FALLBACK)).toEqual(chosen);
    expect(parseReading(JSON.stringify({ font: 'mono', size: 22, leading: 'wide' }), FALLBACK)).toEqual({ ...FALLBACK, leading: 'wide' });
    expect(parseReading('null', FALLBACK)).toEqual(FALLBACK);
  });

  it('reads reading settings stored before 응답이 올 때 as following the reply', () => {
    expect(parseReading(JSON.stringify({ font: 'sans', size: 17, leading: 'normal', width: 'normal' }), FALLBACK).reply).toBe('follow');
    expect(parseReading(JSON.stringify({ ...FALLBACK, reply: 'jump' }), FALLBACK).reply).toBe('follow');
  });
});

describe('stored display settings', () => {
  it('keeps a known theme, color picks and real switches, and starts anything else from the fallback', () => {
    const chosen = { theme: 'light', bg: 'blue', ink: 'soft', accent: 'rose', hideHeader: false, foldComposer: true, hidePictures: true } as const;
    expect(parseDisplay(JSON.stringify(chosen), DISPLAY_DEFAULT)).toEqual(chosen);
    expect(parseDisplay(JSON.stringify({ theme: 'sepia', bg: 'teal', accent: 3, hideHeader: 'no', hidePictures: 1 }), DISPLAY_DEFAULT)).toEqual(DISPLAY_DEFAULT);
  });
});

describe('the current preset', () => {
  it('is the one whose every look value matches, whatever 응답이 올 때 and the chrome switches say', () => {
    const list = presets(FALLBACK);
    expect(presetOf(list, { ...FALLBACK, reply: 'stay' }, { ...DISPLAY_DEFAULT, hideHeader: false })?.name).toBe('기본');
    expect(presetOf(list, FALLBACK, { ...DISPLAY_DEFAULT, theme: 'light' })?.name).toBe('밝은 서재');
    expect(presetOf(list, { ...FALLBACK, size: 16 }, DISPLAY_DEFAULT)).toBeUndefined();
    expect(presetOf(list, FALLBACK, { ...DISPLAY_DEFAULT, accent: 'blue' })).toBeUndefined();
  });
});

describe('saved presets', () => {
  it('reads each saved look, and counts one with a value this version does not know instead of showing it', () => {
    const look = lookOf(FALLBACK, { ...DISPLAY_DEFAULT, bg: 'green', accent: 'violet' });
    const read = savedPresets([
      { name: '숲', look },
      { name: '다음 버전', look: { ...look, bg: 'aurora' } },
    ]);
    expect(read).toEqual({ presets: [{ name: '숲', look }], unread: 1 });
    expect(presetOf(read.presets, FALLBACK, { ...DISPLAY_DEFAULT, bg: 'green', accent: 'violet' })?.name).toBe('숲');
  });
});
