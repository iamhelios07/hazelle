import { expect, it } from 'vitest';
import { paragraphsOf, placeOf } from './illustration';

it('takes each non-blank line as a paragraph, whether the prose breaks with one newline or two', () => {
  expect(paragraphsOf('  First line.\nSecond line.\n\n\nThird after a gap.  \n')).toEqual(['First line.', 'Second line.', 'Third after a gap.']);
  expect(paragraphsOf('\n \n')).toEqual([]);
});

it('places a picture whose paragraph an edit removed at the message end', () => {
  expect(placeOf({ paragraph: 1 }, 'One.\nTwo.')).toBe(1);
  expect(placeOf({ paragraph: 2 }, 'One.\nTwo.')).toBeNull();
});
