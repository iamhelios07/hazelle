import { expect, it } from 'vitest';
import { mergeStatus } from './useAutosave';

it('says the worst of several saves: a failure, then a save under way, then a finished one', () => {
  expect(mergeStatus('saved', 'failed', 'saving')).toBe('failed');
  expect(mergeStatus(null, 'saved', 'saving')).toBe('saving');
  expect(mergeStatus(null, 'saved')).toBe('saved');
  expect(mergeStatus(null, null)).toBe(null);
});
