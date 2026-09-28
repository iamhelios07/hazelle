import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/import/types';
import { KEEP_DELETED, type Character, type Lore } from '../model/library';
import { randomBytes } from '../vault/aead';
import { getBlob } from './blobs';
import { addCharacter, copyCharacter, purgeExpired } from './library';
import { testServer } from './testing';

const server = testServer();

describe('copyCharacter', () => {
  it('copies the card under its new name with the lorebook and the picture, and remembers the origin', async () => {
    const { store, vault } = await server.account();
    const luna: Character = { card: { name: '루나' } as Card, folder: 'f', loreFolders: [{ id: 'town', name: '마을' }] };
    const entry = { name: '등대', content: '폭풍 치는 밤의 등대', folder: 'town' } as Lore;
    const image = randomBytes(64);
    const original = await addCharacter(store, vault, luna, [entry], { bytes: image, type: 'image/png', thumb: 'data:thumb' }, () => {});
    const id = original.ok ? original.data : '';

    const copied = await copyCharacter(store, vault, id, '루나 (사본)', () => {});
    const copy = copied.ok ? copied.data : '';
    expect(store.get('character', copy)?.value).toEqual({ ...luna, card: { name: '루나 (사본)' }, origin: { id, name: '루나' } });
    expect(store.children('lore', copy).map((lore) => lore.value)).toEqual([entry]);
    const [before, after] = [id, copy].map((parent) => store.children('avatar', parent)[0]!);
    expect(after!.id).not.toBe(before!.id);
    expect(after!.value).toEqual(before!.value);
    expect(await getBlob(vault, after!.id)).toEqual({ ok: true, data: image });
  });
});

describe('purgeExpired', () => {
  it('removes a character deleted a week ago with everything it owns, and keeps one deleted since', async () => {
    const { store, vault, blobs } = await server.account();
    const now = Date.now();
    const deleted = (name: string, at: number): Character => ({ card: { name } as Card, folder: null, loreFolders: [], deleted: at });
    const picture = { bytes: randomBytes(8), type: 'image/png', thumb: 'data:thumb' };
    const expired = await addCharacter(store, vault, deleted('old', now - KEEP_DELETED), [{ name: 'lore' } as Lore], picture, () => {});
    await addCharacter(store, vault, deleted('recent', now - 1000), [], null, () => {});
    const chat = await store.create('chat', { title: null, character: expired.ok ? expired.data : '', models: {} });
    await store.create('entry', { type: 'message', role: 'user', at: now, text: '안녕', receipt: null }, { parent: chat.ok ? chat.data.id : '' });
    const blob = store.list('avatar')[0]!.id;

    await purgeExpired(store, vault, now);
    expect(store.list('character').map((kept) => kept.value.card.name)).toEqual(['recent']);
    expect([store.list('chat'), store.list('entry'), store.list('lore'), store.list('avatar')].map((left) => left.length)).toEqual([0, 0, 0, 0]);
    expect(await blobs.get(blob)).toBeNull();
  });
});
