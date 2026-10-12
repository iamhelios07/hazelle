import { expect, it } from 'vitest';
import { retryWait } from './streams';

it('waits longer after each try, or as long as the provider asks, and not at all past a minute', () => {
  expect([1, 2, 3].map((tries) => retryWait(tries, null, 0))).toEqual([2000, 4000, 8000]);
  expect(retryWait(1, '7', 0)).toBe(7000);
  expect(retryWait(1, new Date(30_000).toUTCString(), 0)).toBe(30_000);
  expect(retryWait(1, '0', 0)).toBe(0);
  expect(retryWait(1, '120', 0)).toBeNull();
  expect(retryWait(2, 'soon', 0)).toBe(4000);
});
