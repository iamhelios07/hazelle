import { expect, it } from 'vitest';
import { capText, typedCap } from './bytes';

it('reads the storage cap typed in MB as bytes, an empty field as no cap, and refuses what is not a size', () => {
  expect(typedCap(' 1.5 ')).toBe(1_500_000);
  expect(typedCap('')).toBeNull();
  expect([typedCap('-1'), typedCap('큼')]).toEqual([undefined, undefined]);
  expect(typedCap(capText(25_000_000))).toBe(25_000_000);
  expect(capText(null)).toBe('');
});
