import { describe, expect, it, vi } from 'vitest';
import type { Card, LoreEntry } from '../engine/import/types';
import { KEEP_DELETED, type Character, type Lore } from '../model/library';
import { SETTINGS_ID } from '../model/settings';
import { randomBytes } from '../vault/aead';
import { addCharacter, copyCharacter, importCharacter, purgeCharacter, purgeExpired, resetToggles, setDeleted, setToggle } from './characters';
import { testServer } from './testing';

const server = testServer();

// The bytes of a picture as far as the import reads one: a PNG's signature.
const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...randomBytes(16)]);
const picture = () => ({ bytes: randomBytes(64), type: 'image/png', thumb: 'data:thumb' });
const bare = (name: string, over: Partial<Character> = {}): Character => ({ card: { name } as Card, folder: null, loreFolders: [], ...over });
const none = { avatar: null, assets: [], lore: [] };

describe('importCharacter', () => {
  it('gives the lorebook folders ids, and each entry its folder by id', async () => {
    const { store, files } = await server.account();
    const entry = (name: string, folder: number | null) => ({ name, folder }) as LoreEntry;
    const saved = await importCharacter(store, files, { card: { name: '루나' } as Card, lore: [entry('등대', 1), entry('항구', null)], loreFolders: ['마을', '바다'], assets: [] }, null, () => {});
    const id = saved.ok ? saved.data.id : '';
    const character = store.get('character', id)!.value;
    expect(character.folder).toBeNull();
    expect(character.loreFolders.map((folder) => folder.name)).toEqual(['마을', '바다']);
    const folderOf = Object.fromEntries(store.children('lore', id).map((lore) => [lore.value.name, lore.value.folder]));
    expect(folderOf).toEqual({ 등대: character.loreFolders[1]!.id, 항구: null });
  });

  it('stores the picture and each asset a picture, once however often it appears, and counts the others', async () => {
    const { store, files } = await server.account();
    const [smile, image] = [png(), picture()];
    const assets = [
      { name: 'smile', read: () => smile },
      { name: 'grin', read: () => smile },
      { name: 'notes', read: () => randomBytes(8) },
      { name: 'lost', read: () => null },
    ];
    const steps: string[] = [];
    const saved = await importCharacter(store, files, { card: { name: '루나' } as Card, lore: [], loreFolders: [], assets }, image, (step) => steps.push(step.kind));
    expect(saved).toMatchObject({ ok: true, data: { skipped: 2, faceless: false } });
    const id = saved.ok ? saved.data.id : '';
    const stored = store.children('asset', id).map(({ value }) => value);
    expect(stored.map(({ name, type, size }) => [name, type, size])).toEqual([
      ['smile', 'image/png', smile.length],
      ['grin', 'image/png', smile.length],
    ]);
    expect(stored[0]!.file).toEqual(stored[1]!.file);
    expect(await files.read(stored[0]!.file)).toEqual({ ok: true, data: smile });
    const avatar = store.children('avatar', id)[0]!.value;
    expect(await files.read(avatar.file)).toEqual({ ok: true, data: image.bytes });
    expect(new Set(steps)).toEqual(new Set(['picture', 'assets', 'saving']));
  });
});

describe('copyCharacter', () => {
  it('copies the card under its new name with the lorebook and the picture, and remembers the origin', async () => {
    const { store, files } = await server.account();
    const luna: Character = { card: { name: '루나' } as Card, folder: 'f', loreFolders: [{ id: 'town', name: '마을' }] };
    const entry = { name: '등대', content: '폭풍 치는 밤의 등대', folder: 'town' } as Lore;
    const saved = await importCharacter(store, files, { card: luna.card, lore: [], loreFolders: [], assets: [{ name: 'smile', read: png }] }, picture(), () => {});
    const imported = saved.ok ? saved.data.id : '';
    const [avatar] = store.children('avatar', imported).map(({ value }) => value);
    const assets = store.children('asset', imported).map(({ value }) => value);
    const original = await addCharacter(store, luna, { avatar: avatar!, assets, lore: [entry] }, () => {});
    const id = original.ok ? original.data : '';

    const copied = await copyCharacter(store, id, '루나 (사본)', () => {});
    const copy = copied.ok ? copied.data : '';
    expect(store.get('character', copy)?.value).toEqual({ ...luna, card: { name: '루나 (사본)' }, origin: { id, name: '루나' } });
    expect(store.children('lore', copy).map((lore) => lore.value)).toEqual([entry]);
    expect(store.children('avatar', copy).map(({ value }) => value)).toEqual([avatar]);
    expect(store.children('asset', copy).map(({ value }) => value)).toEqual(assets);
  });
});

describe('purgeExpired', () => {
  it('removes a character deleted a week ago with everything it owns, and keeps one deleted since', async () => {
    const { store, files } = await server.account();
    const now = Date.now();
    const saved = await importCharacter(store, files, { card: { name: 'old' } as Card, lore: [{ name: 'lore', folder: null } as LoreEntry], loreFolders: [], assets: [{ name: 'smile', read: png }] }, picture(), () => {});
    const expired = saved.ok ? saved.data.id : '';
    await setDeleted(store, expired, now - KEEP_DELETED);
    await addCharacter(store, bare('recent', { deleted: now - 1000 }), none, () => {});
    const chat = await store.create('chat', { title: null, character: expired, models: {} });
    await store.create('entry', { type: 'message', role: 'user', at: now, text: '안녕', receipt: null }, { parent: chat.ok ? chat.data.id : '' });

    await purgeExpired(store, now, new AbortController().signal);
    expect(store.list('character').map((kept) => kept.value.card.name)).toEqual(['recent']);
    expect([store.list('chat'), store.list('entry'), store.list('lore'), store.list('avatar'), store.list('asset')].map((left) => left.length)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('setToggle', () => {
  it('keeps values per character and for 캐릭터 없이, and resetToggles drops a character’s', async () => {
    const { store } = await server.account();
    const added = await addCharacter(store, bare('루나'), none, () => {});
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
    const { store, open } = await server.account();
    const added = await addCharacter(store, bare('루나'), { ...none, lore: [{ name: 'lore' } as Lore] }, () => {});
    const id = added.ok ? added.data : '';
    const chat = await store.create('chat', { title: null, character: id, models: {} });
    const chatId = chat.ok ? chat.data.id : '';
    await store.create('entry', { type: 'message', role: 'user', at: 1, text: '안녕', receipt: null }, { parent: chatId });

    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (url === '/api/objects/batch' && (JSON.parse(init?.body as string) as { writes: { id: string; body: string | null }[] }).writes.some((write) => write.id === chatId && write.body === null) ? Promise.reject(new TypeError('Failed to fetch')) : real(url, init)));
    expect(await purgeCharacter(store, id, () => {})).toEqual({ ok: false, error: 'offline' });
    const other = await open();
    await other.pull();
    expect([other.get('character', id), other.get('chat', chatId)].map((kept) => kept?.id)).toEqual([id, chatId]);
    expect([other.list('entry'), other.list('lore')].map((left) => left.length)).toEqual([0, 0]);

    vi.stubGlobal('fetch', real);
    const steps: [number, number][] = [];
    expect(await purgeCharacter(store, id, (removed, total) => steps.push([removed, total]))).toEqual({ ok: true, data: null });
    expect(steps).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect([store.list('character'), store.list('chat')].map((left) => left.length)).toEqual([0, 0]);
  });
});
