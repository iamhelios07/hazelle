import { expect, it } from 'vitest';
import { placeMark, withMarks } from '../../model/illustration';
import { ORIGINAL_MARK as O } from '../ui';
import { withOriginal } from './withOriginal';

it('follows each translated paragraph with its original when the counts match', () => {
  expect(withOriginal('하나\n<hr>\n둘', 'One\n<hr>\nTwo')).toBe(`하나\n\nOne${O}\n\n<hr>\n둘\n\nTwo${O}\n`);
});

it('puts the whole original after the whole translation when the counts differ', () => {
  expect(withOriginal('하나 둘', 'One\nTwo')).toBe(`하나 둘\n\nOne${O}\n\n\nTwo${O}\n`);
});

it("keeps a picture's mark after its translated paragraph and that paragraph's original", () => {
  expect(withOriginal(withMarks('하나\n둘', new Set([0])), 'One\nTwo')).toBe(`하나\n\nOne${O}\n\n${placeMark(0)}\n둘\n\nTwo${O}\n`);
});
