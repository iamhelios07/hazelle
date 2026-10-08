import { expect, it } from 'vitest';
import { paragraphsOf, placeMark, placeOf, withMarks, withoutMarks } from './illustration';

it('takes each non-blank line as a paragraph, whether the prose breaks with one newline or two', () => {
  expect(paragraphsOf('  First line.\nSecond line.\n\n\nThird after a gap.  \n')).toEqual(['First line.', 'Second line.', 'Third after a gap.']);
  expect(paragraphsOf('\n \n')).toEqual([]);
});

it('places a picture whose paragraph an edit removed at the message end', () => {
  expect(placeOf({ paragraph: 1 }, 'One.\nTwo.')).toBe(1);
  expect(placeOf({ paragraph: 2 }, 'One.\nTwo.')).toBeNull();
});

it('marks a paragraph on its own line after it, none past the end, and takes the marks out but the one kept', () => {
  const text = 'One.\n\n  Two.\nThree.';
  const marked = withMarks(text, new Set([1, 5]));
  expect(marked).toBe(`One.\n\n  Two.\n${placeMark(1)}\nThree.`);
  expect(withoutMarks(marked)).toBe(text);
  expect(withoutMarks(withMarks(text, new Set([0, 1])), 1)).toBe(`One.\n\n  Two.\n${placeMark(1)}\nThree.`);
});
