import { describe, expect, it } from 'vitest';
import { GUIDES, tryExample } from './guides';

describe('GUIDES', () => {
  it('gives the result each example shows', () => {
    for (const { example } of Object.values(GUIDES).flatMap((guide) => guide.steps)) if (example) expect(tryExample(example.written, example.inMessage)).toBe(example.result);
  });
});
