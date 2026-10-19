import { describe, expect, it } from 'vitest';
import { arrange, placeBefore, rearrange, toFront } from './order';

const named = (...names: string[]) => names.map((name) => ({ id: name, name }));
const ids = (items: { id: string }[]) => items.map(({ id }) => id);

describe('직접 순서', () => {
  it('puts the unnamed first by name, then the named by their place', () => {
    expect(ids(arrange(['c', 'a'], named('a', 'z', 'c', 'b'), ({ id }) => id, ({ name }) => name))).toEqual(['b', 'z', 'c', 'a']);
  });

  it('rearranges one place inside the places it held, the rest staying put', () => {
    // a and c sit in the folder; x and y elsewhere. new is the folder's, not yet named.
    expect(rearrange(['a', 'x', 'c', 'y'], ['c', 'new', 'a'])).toEqual(['c', 'new', 'x', 'a', 'y']);
  });

  it('files moved things first', () => {
    expect(toFront(['a', 'b', 'c'], ['c'])).toEqual(['c', 'a', 'b']);
  });

  it('moves one before another, or last', () => {
    expect(placeBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(placeBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
  });
});
