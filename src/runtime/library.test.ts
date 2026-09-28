import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import { randomBytes } from '../vault/aead';
import { getBlob } from './blobs';
import { fakeServer } from './fake-server';
import { addCharacter, copyCharacter, holds, nest, shelve, shownFolders, type Avatar, type Character, type Folder, type Lore } from './library';
import { ObjectStore, type Stored } from './store';

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

describe('nest', () => {
  it('puts subfolders under their top folder by name, and lifts one whose top folder is gone', () => {
    const folder = (id: string, name: string, parent?: string): Stored<Folder> => ({ id, kind: 'folder', parent: null, rev: 1, value: parent ? { name, parent } : { name } });
    const tree = nest([folder('k', '기사단', 'f'), folder('f', '판타지'), folder('m', '마법사', 'f'), folder('o', '고아', 'gone'), folder('d', '데일리')]);
    expect(tree.map((top) => [top.id, top.children.map((child) => child.id)])).toEqual([
      ['o', []],
      ['d', []],
      ['f', ['k', 'm']],
    ]);
    expect([...shownFolders(tree)].sort()).toEqual(['d', 'f', 'k', 'm', 'o']);
    const inKnights = character('a', 1).value;
    inKnights.folder = 'k';
    expect(holds(tree[2]!, inKnights)).toBe(true);
    expect(holds(tree[2]!.children[1]!, inKnights)).toBe(false);
  });
});

describe('copyCharacter', () => {
  it('copies the card under its new name with the lorebook and the picture, and remembers the origin', async () => {
    const server = fakeServer();
    const vault = { accountId: 'account-1', vaultKey: randomBytes(32), request: server.request };
    const store = await ObjectStore.open(vault.accountId, vault.vaultKey, server.request);
    const luna: Character = { card: { name: '루나' } as Card, folder: 'f', loreFolders: [{ id: 'town', name: '마을' }] };
    const entry = { name: '등대', content: '폭풍 치는 밤의 등대', folder: 'town' } as Lore;
    const image = randomBytes(64);
    const original = await addCharacter(store, vault, luna, [entry], { bytes: image, type: 'image/png', thumb: 'data:thumb' }, () => {});
    const id = original.ok ? original.data : '';

    const copied = await copyCharacter(store, vault, id, '루나 (사본)', () => {});
    const copy = copied.ok ? copied.data : '';
    expect(store.get<Character>(copy)?.value).toEqual({ ...luna, card: { name: '루나 (사본)' }, origin: { id, name: '루나' } });
    expect(store.list<Lore>('lore').filter((lore) => lore.parent === copy).map((lore) => lore.value)).toEqual([entry]);
    const [before, after] = [id, copy].map((parent) => store.list<Avatar>('avatar').find((avatar) => avatar.parent === parent)!);
    expect(after!.id).not.toBe(before!.id);
    expect(after!.value).toEqual(before!.value);
    expect(await getBlob(vault, after!.id)).toEqual({ ok: true, data: image });
  });
});
