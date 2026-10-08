import { expect, it } from 'vitest';
import { isValue } from './kinds';

it("reads a summary's verdict as absent or well formed, and refuses a malformed one", () => {
  const summary = { version: 1, head: 0, chatRev: 1, dependencies: [], rendered: { now: 0, timeZone: 'UTC' }, character: null, title: '', preview: '', count: 0, at: null, order: 1, recent: [] };
  expect(isValue('summary', summary)).toBe(true);
  expect(isValue('summary', { ...summary, stuck: { dependencies: [{ kind: 'character', id: 'c', rev: 2 }] } })).toBe(true);
  expect(isValue('summary', { ...summary, stuck: null })).toBe(false);
  expect(isValue('summary', { ...summary, stuck: { dependencies: 'c' } })).toBe(false);
});
