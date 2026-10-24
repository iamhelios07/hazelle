import { expect, it } from 'vitest';
import { cacheDiff } from './cache-diff';

it('keeps Korean syllables and astral characters whole while retaining common stretches', () => {
  expect(cacheDiff('오늘😀 12:01 맑음', '오늘😀 12:03 흐림')).toEqual({ coarse: false, runs: [
    { kind: 'same', text: '오늘😀 12:0' }, { kind: 'before', text: '1' }, { kind: 'after', text: '3' }, { kind: 'same', text: ' ' }, { kind: 'before', text: '맑음' }, { kind: 'after', text: '흐림' },
  ] });
});

it('trims a long unchanged frame before bounding the middle, and exposes a lossless coarse fallback', () => {
  const frame = '가'.repeat(100_000);
  expect(cacheDiff(`${frame}1${frame}`, `${frame}2${frame}`).coarse).toBe(false);
  const before = frame + '나'.repeat(100_000) + frame;
  const after = frame + '다'.repeat(100_000) + frame;
  const diff = cacheDiff(before, after);
  expect(diff.coarse).toBe(true);
  expect(diff.runs.map(({ kind }) => kind)).toEqual(['same', 'before', 'after', 'same']);
  expect(diff.runs.filter(({ kind }) => kind !== 'after').map(({ text }) => text).join('')).toBe(before);
  expect(diff.runs.filter(({ kind }) => kind !== 'before').map(({ text }) => text).join('')).toBe(after);
});
