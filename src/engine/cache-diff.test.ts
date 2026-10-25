import { expect, it } from 'vitest';
import { cacheDiff } from './cache-diff';

it('compares whole numbers and words, joining a short unchanged stretch into the changes around it', () => {
  expect(cacheDiff('오늘😀 12:01 맑음', '오늘😀 12:03 흐림')).toEqual({ coarse: false, runs: [
    { kind: 'same', text: '오늘😀 12:' }, { kind: 'before', text: '01 맑음' }, { kind: 'after', text: '03 흐림' },
  ] });
  expect(cacheDiff('지금 22:15:30 이에요', '지금 23:36:42 이에요').runs).toEqual([
    { kind: 'same', text: '지금 ' }, { kind: 'before', text: '22:15:30' }, { kind: 'after', text: '23:36:42' }, { kind: 'same', text: ' 이에요' },
  ]);
  expect(cacheDiff('오후 3시 20분', '오후 4시 5분').runs).toEqual([
    { kind: 'same', text: '오후 ' }, { kind: 'before', text: '3' }, { kind: 'after', text: '4' }, { kind: 'same', text: '시 ' }, { kind: 'before', text: '20' }, { kind: 'after', text: '5' }, { kind: 'same', text: '분' },
  ]);
  expect(cacheDiff('今日は晴れです', '今日は雨です').runs).toEqual([
    { kind: 'same', text: '今日は' }, { kind: 'before', text: '晴れ' }, { kind: 'after', text: '雨' }, { kind: 'same', text: 'です' },
  ]);
});

it('trims a long unchanged frame before bounding the middle, and exposes a lossless coarse fallback', () => {
  const frame = '가 '.repeat(100_000);
  expect(cacheDiff(`${frame}1${frame}`, `${frame}2${frame}`).coarse).toBe(false);
  const before = frame + '나 '.repeat(1_000) + frame;
  const after = frame + '다 '.repeat(1_000) + frame;
  const diff = cacheDiff(before, after);
  expect(diff.coarse).toBe(true);
  expect(diff.runs.map(({ kind }) => kind)).toEqual(['same', 'before', 'after', 'same']);
  expect(diff.runs.filter(({ kind }) => kind !== 'after').map(({ text }) => text).join('')).toBe(before);
  expect(diff.runs.filter(({ kind }) => kind !== 'before').map(({ text }) => text).join('')).toBe(after);
});
