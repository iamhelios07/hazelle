import { describe, expect, it, vi } from 'vitest';
import type { Card, LoreEntry } from '../engine/import/types';
import { KEEP_DELETED, type Character, type Lore } from '../model/library';
import { SETTINGS_ID } from '../model/settings';
import { randomBytes } from '../vault/aead';
import { addCharacter, copyCharacter, importCharacter, purgeCharacter, purgeExpired, resetToggles, setToggle } from './characters';
import { testServer } from './testing';

const server = testServer();

describe('importCharacter', () => {
  it('gives the lorebook folders ids, and each entry its folder by id', async () => {
    const { store, files } = await server.account();
    const entry = (name: string, folder: number | null) => ({ name, folder }) as LoreEntry;
    const saved = await importCharacter(store, files, { card: { name: '루나' } as Card, lore: [entry('등대', 1), entry('항구', null)], loreFolders: ['마을', '바다'] }, null, () => {});
    const character = store.get('character', saved.ok ? saved.data : '')!.value;
    expect(character.folder).toBeNull();
    expect(character.loreFolders.map((folder) => folder.name)).toEqual(['마을', '바다']);
    const folderOf = Object.fromEntries(store.children('lore', saved.ok ? saved.data : '').map((lore) => [lore.value.name, lore.value.folder]));
    expect(folderOf).toEqual({ 등대: character.loreFolders[1]!.id, 항구: null });
  });
});

describe('copyCharacter', () => {
  it('copies the card under its new name with the lorebook and the picture, and remembers the origin', async () => {
    const { store, files } = await server.account();
    const luna: Character = { card: { name: '루나' } as Card, folder: 'f', loreFolders: [{ id: 'town', name: '마을' }] };
    const entry = { name: '등대', content: '폭풍 치는 밤의 등대', folder: 'town' } as Lore;
    const image = randomBytes(64);
    const original = await addCharacter(store, files, luna, [entry], { bytes: image, type: 'image/png', thumb: 'data:thumb' }, () => {});
    const id = original.ok ? original.data : '';

    const copied = await copyCharacter(store, files, id, '루나 (사본)', () => {});
    const copy = copied.ok ? copied.data : '';
    expect(store.get('character', copy)?.value).toEqual({ ...luna, card: { name: '루나 (사본)' }, origin: { id, name: '루나' } });
    expect(store.children('lore', copy).map((lore) => lore.value)).toEqual([entry]);
    const [before, after] = [id, copy].map((parent) => store.children('avatar', parent)[0]!);
    expect(after!.id).not.toBe(before!.id);
    expect(after!.value).toEqual(before!.value);
    expect(await files.get(after!.id)).toEqual({ ok: true, data: image });
  });
});

describe('purgeExpired', () => {
  it('removes a character deleted a week ago with everything it owns, and keeps one deleted since', async () => {
    const { store, files, blobs } = await server.account();
    const now = Date.now();
    const deleted = (name: string, at: number): Character => ({ card: { name } as Card, folder: null, loreFolders: [], deleted: at });
    const picture = { bytes: randomBytes(8), type: 'image/png', thumb: 'data:thumb' };
    const expired = await addCharacter(store, files, deleted('old', now - KEEP_DELETED), [{ name: 'lore' } as Lore], picture, () => {});
    await addCharacter(store, files, deleted('recent', now - 1000), [], null, () => {});
    const chat = await store.create('chat', { title: null, character: expired.ok ? expired.data : '', models: {} });
    await store.create('entry', { type: 'message', role: 'user', at: now, text: '안녕', receipt: null }, { parent: chat.ok ? chat.data.id : '' });
    const blob = store.list('avatar')[0]!.id;

    await purgeExpired(store, files, now, new AbortController().signal);
    expect(store.list('character').map((kept) => kept.value.card.name)).toEqual(['recent']);
    expect([store.list('chat'), store.list('entry'), store.list('lore'), store.list('avatar')].map((left) => left.length)).toEqual([0, 0, 0, 0]);
    expect(await blobs.get(blob)).toBeNull();
  });
});

describe('setToggle', () => {
  it('keeps values per character and for 캐릭터 없이, and resetToggles drops a character’s', async () => {
    const { store, files } = await server.account();
    const added = await addCharacter(store, files, { card: { name: '루나' } as Card, folder: null, loreFolders: [] }, [], null, () => {});
    const id = added.ok ? added.data : '';
    await setToggle(store, id, 'sims', '1');
    await setToggle(store, id, 'mode', '2');
    await setToggle(store, null, 'sims', '0');
    expect([store.get('character', id)?.value.toggles, store.get('settings', SETTINGS_ID)?.value.toggles]).toEqual([{ sims: '1', mode: '2' }, { sims: '0' }]);
    await resetToggles(store, id);
    expect(store.get('character', id)?.value.toggles).toBeUndefined();
  });
});

describe('purgeCharacter', () => {
  it('leaves the character in place when a removal fails midway, and finishes when tried again', async () => {
    const { store, files, open } = await server.account();
    const added = await addCharacter(store, files, { card: { name: '루나' } as Card, folder: null, loreFolders: [] }, [{ name: 'lore' } as Lore], { bytes: randomBytes(8), type: 'image/png', thumb: 'data:thumb' }, () => {});
    const id = added.ok ? added.data : '';
    const chat = await store.create('chat', { title: null, character: id, models: {} });
    const chatId = chat.ok ? chat.data.id : '';
    await store.create('entry', { type: 'message', role: 'user', at: 1, text: '안녕', receipt: null }, { parent: chatId });

    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (url === '/api/objects/batch' && (JSON.parse(init?.body as string) as { writes: { id: string; body: string | null }[] }).writes.some((write) => write.id === chatId && write.body === null) ? Promise.reject(new TypeError('Failed to fetch')) : real(url, init)));
    expect(await purgeCharacter(store, files, id, () => {})).toEqual({ ok: false, error: 'offline' });
    const other = await open();
    await other.pull();
    expect([other.get('character', id), other.get('chat', chatId)].map((kept) => kept?.id)).toEqual([id, chatId]);
    expect([other.list('entry'), other.list('lore'), other.list('avatar')].map((left) => left.length)).toEqual([0, 0, 0]);

    vi.stubGlobal('fetch', real);
    const steps: [number, number][] = [];
    expect(await purgeCharacter(store, files, id, (removed, total) => steps.push([removed, total]))).toEqual({ ok: true, data: null });
    expect(steps).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect([store.list('character'), store.list('chat')].map((left) => left.length)).toEqual([0, 0]);
  });
});
