import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import type { Stored } from './kinds';
import { characterTexts, daysLeft, holds, KEEP_DELETED, nest, shelve } from './library';

const character = (id: string, rev: number): Stored<'character'> => ({ id, kind: 'character', parent: null, rev, value: { card: { name: id } as Card, folder: null, loreFolders: [] } });
const chat = (id: string, character: string | null, order: number) => ({ id, chat: { character }, order });

describe('shelve', () => {
  it('groups chats under their character, most recent character first, those without chats last by name, and keeps characterless chats apart', () => {
    const avatar: Stored<'avatar'> = { id: 'blob', kind: 'avatar', parent: 'b', rev: 3, value: { type: 'image/png', size: 1, thumb: 'data:thumb', file: { id: 'f', key: 'k' } } };
    // Newest first, as chatItems gives them.
    const chats = [chat('c3', null, 9), chat('c2', 'a', 8), chat('c1', 'a', 5)];
    const { characters, none } = shelve([character('a', 1), character('c', 7), character('b', 2)], [avatar], chats, []);
    expect(characters.map((shelf) => [shelf.id, shelf.chats.map((item) => item.id)])).toEqual([
      ['a', ['c2', 'c1']],
      ['b', []],
      ['c', []],
    ]);
    expect(characters.find((shelf) => shelf.id === 'b')!.face).toBe('data:thumb');
    expect(none.chats.map((item) => item.id)).toEqual(['c3']);
  });

  it('lists a character being removed for good nowhere', () => {
    const claimed = character('d', 2);
    claimed.value.deleted = 1;
    claimed.value.purging = true;
    const { characters, deleted } = shelve([character('a', 1), claimed], [], [], []);
    expect([characters.map((shelf) => shelf.id), deleted]).toEqual([['a'], []]);
  });

  it('keeps deleted characters and their chats apart', () => {
    const gone = character('d', 4);
    gone.value.deleted = 1;
    const { characters, deleted } = shelve([character('a', 1), gone], [], [chat('c1', 'd', 5)], []);
    expect(characters.map((shelf) => shelf.id)).toEqual(['a']);
    expect(deleted.map((shelf) => [shelf.id, shelf.chats.map((item) => item.id)])).toEqual([['d', ['c1']]]);
  });
});

describe('nest', () => {
  it('puts subfolders under their top folder by name, and lifts one whose top folder is gone', () => {
    const folder = (id: string, name: string, parent?: string): Stored<'folder'> => ({ id, kind: 'folder', parent: null, rev: 1, value: parent ? { name, parent } : { name } });
    const tree = nest([folder('k', '기사단', 'f'), folder('f', '판타지'), folder('m', '마법사', 'f'), folder('o', '고아', 'gone'), folder('d', '데일리')]);
    expect(tree.map((top) => [top.id, top.children.map((child) => child.id)])).toEqual([
      ['o', []],
      ['d', []],
      ['f', ['k', 'm']],
    ]);
    const inKnights = character('a', 1).value;
    inKnights.folder = 'k';
    expect(holds(tree[2]!, inKnights)).toBe(true);
    expect(holds(tree[2]!.children[1]!, inKnights)).toBe(false);
  });
});

describe('daysLeft', () => {
  it('counts whole days left in 휴지통, and reaches 0 when the character is due', () => {
    const gone = { ...character('a', 1).value, deleted: 0 };
    expect(daysLeft(gone, 0)).toBe(7);
    expect(daysLeft(gone, KEEP_DELETED - 1)).toBe(1);
    expect(daysLeft(gone, KEEP_DELETED)).toBe(0);
  });
});

describe('characterTexts', () => {
  it('reads the name, the nickname and the alias', () => {
    const luna = character('Luna', 1).value;
    luna.card.nickname = '달토끼';
    luna.alias = '겨울 버전';
    expect(characterTexts(luna)).toEqual(['Luna', '달토끼', '겨울 버전']);
  });
});
