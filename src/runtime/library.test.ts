import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import { shelve, type Avatar, type Character } from './library';
import type { Stored } from './store';

const character = (id: string, rev: number): Stored<Character> => ({ id, kind: 'character', parent: null, rev, value: { card: { name: id } as Card, folder: null, loreFolders: [] } });
const chat = (id: string, character: string | null, order: number) => ({ id, chat: { character }, order });

describe('shelve', () => {
  it('groups chats under their character, most recent character first, and keeps characterless chats apart', () => {
    const avatar: Stored<Avatar> = { id: 'blob', kind: 'avatar', parent: 'b', rev: 3, value: { type: 'image/png', size: 1, thumb: 'data:thumb' } };
    // Newest first, as useChats gives them.
    const chats = [chat('c3', null, 9), chat('c2', 'a', 8), chat('c1', 'a', 5)];
    const { characters, none } = shelve([character('a', 1), character('b', 2), character('c', 7)], [avatar], chats);
    expect(characters.map((shelf) => [shelf.id, shelf.order, shelf.chats.map((item) => item.id)])).toEqual([
      ['a', 8, ['c2', 'c1']],
      ['c', 7, []],
      ['b', 2, []],
    ]);
    expect(characters.find((shelf) => shelf.id === 'b')!.face).toBe('data:thumb');
    expect(none.chats.map((item) => item.id)).toEqual(['c3']);
  });
});
