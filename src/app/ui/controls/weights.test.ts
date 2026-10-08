import { expect, it } from 'vitest';
import { tagWeights } from './weights';

const round = (text: string) => tagWeights(text).map(({ text: piece, weight }) => [piece, weight === null ? null : Math.round(weight * 10000) / 10000]);

it('reads NovelAI weights: nested braces and brackets, a number until a bare ::, which closes brackets too', () => {
  expect(round('artist:a, {{b}}, [c], 1.5::rain, night ::, {{{d ::e, -1::hat::')).toEqual([
    ['artist:a, ', 1],
    ['{{', null],
    ['b', 1.1025],
    ['}}', null],
    [', ', 1],
    ['[', null],
    ['c', 0.9524],
    [']', null],
    [', ', 1],
    ['1.5::', null],
    ['rain, night ', 1.5],
    ['::', null],
    [', ', 1],
    ['{{{', null],
    ['d ', 1.1576],
    ['::', null],
    ['e, ', 1],
    ['-1::', null],
    ['hat', -1],
    ['::', null],
  ]);
  expect(tagWeights('2girls, 1990s (style)').map(({ text }) => text).join('')).toBe('2girls, 1990s (style)');
});
