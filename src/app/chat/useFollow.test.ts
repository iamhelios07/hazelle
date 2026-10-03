import { describe, expect, it } from 'vitest';
import { atEnd } from './useFollow';

describe('the view at the story end', () => {
  it('stays at the end until well above it, and comes back only at the very end', () => {
    expect(atEnd(0, false)).toBe(true);
    expect(atEnd(10, false)).toBe(false);
    expect(atEnd(10, true)).toBe(true);
    expect(atEnd(48, true)).toBe(false);
  });
});
