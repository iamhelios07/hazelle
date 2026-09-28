import { describe, expect, it } from 'vitest';
import { seeded } from './random';

describe('seeded', () => {
  it('repeats its sequence for a seed, differs across seeds, and stays in [0, 1)', () => {
    const take = (seed: string) => {
      const next = seeded(seed);
      return Array.from({ length: 50 }, next);
    };
    expect(take('version-1:0')).toEqual(take('version-1:0'));
    expect(take('version-1:0')).not.toEqual(take('version-1:1'));
    expect(take('').every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
