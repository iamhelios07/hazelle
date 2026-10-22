import { expect, it } from 'vitest';
import { paragraphsOf, pictureCount, placeMark, placeOf, translatedMarks, withMarks, withoutMarks, type Illustration } from './illustration';

it('takes each non-blank line as a paragraph, whether the prose breaks with one newline or two', () => {
  expect(paragraphsOf('  First line.\nSecond line.\n\n\nThird after a gap.  \n')).toEqual(['First line.', 'Second line.', 'Third after a gap.']);
  expect(paragraphsOf('\n \n')).toEqual([]);
});

it('counts no line of tags alone, in the paragraphs or the marks', () => {
  const text = '<GT-SEP/>\n⏱️[11:21 AM]\n<div class="box">\n<b>Hi.</b>\n</div>';
  expect(paragraphsOf(text)).toEqual(['⏱️[11:21 AM]', '<b>Hi.</b>']);
  expect(withMarks(text, new Set([0]))).toBe(`<GT-SEP/>\n⏱️[11:21 AM]\n${placeMark(0)}\n<div class="box">\n<b>Hi.</b>\n</div>`);
});

it('finds a picture its line again when lines come above it, and keeps the number of one placed without its line', () => {
  const picture = (line?: string) => ({ scene: { paragraph: 1 }, ...(line !== undefined && { line }) }) as Illustration;
  expect(placeOf(picture('Two.'), '<status>\nHP 100\nMP 50\n</status>\nOne.\nTwo.')).toBe(3);
  expect(placeOf(picture('Two.'), 'Two.\nOne.\nThree.\nTwo.')).toBe(0);
  expect(placeOf(picture('Two.'), 'One.\nTwo, rewritten.')).toBe(1);
  expect(placeOf(picture(), 'Zero.\nOne.\nTwo.')).toBe(1);
});

it('marks a paragraph on its own line after it, none past the end, and takes the marks out but the ones kept', () => {
  const text = 'One.\n\n  Two.\nThree.';
  const marked = withMarks(text, new Set([1, 5]));
  expect(marked).toBe(`One.\n\n  Two.\n${placeMark(1)}\nThree.`);
  expect(withoutMarks(marked)).toBe(text);
  expect(withoutMarks(withMarks(text, new Set([0, 1])), new Set([1]))).toBe(`One.\n\n  Two.\n${placeMark(1)}\nThree.`);
});

it('marks a translation after the displayed paragraph its mark follows, past a status window the display drew over many lines', () => {
  const status = '<div class="status">\n<b>HP</b> 100\n<b>MP</b> 50\n</div>';
  // Stored as '[HP 100 | MP 50]\nOne.\nTwo.', its picture after paragraph 1.
  const placed = `${status}\nOne.\n${placeMark(1)}\nTwo.`;
  expect(translatedMarks(`${status}\n하나.\n둘.`, placed, new Set([1]))).toBe(`${status}\n하나.\n${placeMark(1)}\n둘.`);
});

it('counts the pictures of the highest rung the text reaches, without its tags, and never more than its paragraphs', () => {
  const text = '<div class="box">0123456789</div>\nabcdefghij\nklmnopqrst';
  const ladder = [{ from: 20, count: 2 }, { from: 30, count: 3 }, { from: 31, count: 5 }];
  expect([pictureCount([], text), pictureCount(ladder, text), pictureCount(ladder.slice(1), text), pictureCount(ladder.slice(2), text)]).toEqual([1, 3, 3, 1]);
  expect(pictureCount([{ from: 1, count: 5 }], text)).toBe(3);
});
