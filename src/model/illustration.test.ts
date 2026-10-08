import { expect, it } from 'vitest';
import { paragraphsOf, placeMark, placeOf, withMarks, withoutMarks } from './illustration';

it('takes each non-blank line as a paragraph, whether the prose breaks with one newline or two', () => {
  expect(paragraphsOf('  First line.\nSecond line.\n\n\nThird after a gap.  \n')).toEqual(['First line.', 'Second line.', 'Third after a gap.']);
  expect(paragraphsOf('\n \n')).toEqual([]);
});

it('counts no line of tags alone, in the paragraphs or the marks', () => {
  const text = '<GT-SEP/>\n⏱️[11:21 AM]\n<div class="box">\n<b>Hi.</b>\n</div>';
  expect(paragraphsOf(text)).toEqual(['⏱️[11:21 AM]', '<b>Hi.</b>']);
  expect(withMarks(text, new Set([0]))).toBe(`<GT-SEP/>\n⏱️[11:21 AM]\n${placeMark(0)}\n<div class="box">\n<b>Hi.</b>\n</div>`);
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
