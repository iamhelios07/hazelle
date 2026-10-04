import { describe, expect, it } from 'vitest';
import { finder } from './search';

describe('finder', () => {
  it('finds the term in what the reader sees, in chat order', () => {
    const find = finder();
    const texts = ['<p class="Hello">nothing</p>', 'Say <b>HEL</b>LO there', 'a < b > hello', '한 안녕', 'hello'];
    expect(find(texts, ' Hello ')).toEqual([1, 2, 4]);
    expect(find(texts, '한')).toEqual([3]);
    expect(find(texts, 'class')).toEqual([]);
    expect(find(texts, '  ')).toEqual([]);
  });
});
