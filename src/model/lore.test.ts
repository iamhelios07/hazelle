import { describe, expect, it } from 'vitest';
import type { Stored } from './kinds';
import type { Lore } from './library';
import { loreGroups } from './lore';

const entry = (id: string, folder: string | null, insertionOrder: number): Stored<'lore'> => ({ id, kind: 'lore', parent: 'owner', rev: 1, value: { name: id, folder, insertionOrder } as Lore });

describe('loreGroups', () => {
  it('lists the entries in no folder first, then each folder in order, each by its order, and one naming a gone folder in none', () => {
    const groups = loreGroups([entry('b', 'sea', 2), entry('a', 'sea', 1), entry('c', null, 5), entry('d', 'gone', 1)], [{ id: 'town', name: '마을' }, { id: 'sea', name: '바다' }]);
    expect(groups.map(({ folder, entries }) => [folder?.id ?? null, entries.map(({ id }) => id)])).toEqual([
      [null, ['d', 'c']],
      ['town', []],
      ['sea', ['a', 'b']],
    ]);
  });
});
