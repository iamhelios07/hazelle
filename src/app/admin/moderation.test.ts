import { expect, it } from 'vitest';
import { moderates } from './moderation';

it('moderates once a second account exists, or while a report or held share waits on a server of one', () => {
  expect(moderates({ people: 1, pending: 0 })).toBe(false);
  expect(moderates({ people: 2, pending: 0 })).toBe(true);
  expect(moderates({ people: 1, pending: 1 })).toBe(true);
});
