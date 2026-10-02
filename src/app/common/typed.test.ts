import { expect, it } from 'vitest';
import { typedText } from './typed';

const read = (typed: string) => (Number.isFinite(Number(typed)) && typed.trim() !== '' ? Number(typed) : null);

it('keeps a text as typed while it reads as the value or as no value, and shows a value set from elsewhere', () => {
  expect(typedText('0.50', read, 0.5, String)).toBe('0.50');
  expect(typedText('0.', read, 0, String)).toBe('0.');
  expect(typedText('abc', read, 7, String)).toBe('abc');
  expect(typedText('0.5', read, 0.9, String)).toBe('0.9');
  expect(typedText(undefined, read, 0.9, String)).toBe('0.9');
});
