import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER } from '../engine/import/convert';
import type { Character } from '../model/library';
import { addLore, addLoreFolder, editLore, loreFolderRemoval, removeLore, removeLoreFolder, renameLoreFolder, restoreLore, restoreLoreFolder, type LoreOwner } from './lore';
import type { ObjectStore } from './store';
import { testCard, testServer } from './testing';

const server = testServer();

async function owned(store: ObjectStore): Promise<LoreOwner> {
  const character: Character = { card: testCard('루나'), folder: null, loreFolders: [{ id: 'sea', name: '바다' }] };
  const created = await store.create('character', character);
  if (!created.ok) throw new Error(created.error);
  return { kind: 'character', id: created.data.id };
}

async function added(store: ObjectStore, owner: string, folder: string | null) {
  const saved = await addLore(store, owner, folder, crypto.randomUUID());
  if (!saved.ok) throw new Error(saved.error);
  return saved.data;
}

describe('addLore', () => {
  it('adds an entry that is on, found by keys and in the lorebook slot, after the last one, in the folder it was added in', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    const first = await added(store, owner.id, null);
    expect(first.parent).toBe(owner.id);
    expect(first.value).toMatchObject({ enabled: true, constant: false, selective: false, position: null, priority: null, folder: null, insertionOrder: DEFAULT_ORDER });
    await editLore(store, first.id, { insertionOrder: 250 });
    expect((await added(store, owner.id, 'sea')).value).toMatchObject({ folder: 'sea', insertionOrder: 251 });
  });
});

describe('editLore', () => {
  it('changes only the fields given', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    const entry = await added(store, owner.id, null);
    await editLore(store, entry.id, { keys: ['등대'] });
    await editLore(store, entry.id, { content: '등대가 있다.' });
    expect(store.get('lore', entry.id)?.value).toMatchObject({ keys: ['등대'], content: '등대가 있다.', enabled: true });
  });
});

describe('removeLore', () => {
  it('removes the entry at once, and restoreLore brings it back under its id', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    const entry = await added(store, owner.id, null);
    const removed = await removeLore(store, entry.id);
    if (!removed.ok) throw new Error(removed.error);
    expect(store.children('lore', owner.id)).toEqual([]);
    await restoreLore(store, removed.data);
    expect(store.children('lore', owner.id).map(({ id }) => id)).toEqual([entry.id]);
  });
});

describe('lore folders', () => {
  it('adds and renames a folder on the owner', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    await addLoreFolder(store, owner, '마을');
    const town = store.get('character', owner.id)!.value.loreFolders[1]!;
    await renameLoreFolder(store, owner, town.id, '항구 마을');
    expect(store.get('character', owner.id)?.value.loreFolders).toEqual([{ id: 'sea', name: '바다' }, { id: town.id, name: '항구 마을' }]);
  });

  it('moves a removed folder’s entries out of every folder, and 되돌리기 puts the folder and its entries back', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    const inside = await added(store, owner.id, 'sea');
    const removal = loreFolderRemoval(store, owner, 'sea')!;
    expect(await removeLoreFolder(store, owner, removal)).toEqual({ ok: true, data: null });
    expect(store.get('character', owner.id)?.value.loreFolders).toEqual([]);
    expect(store.get('lore', inside.id)?.value.folder).toBeNull();
    await restoreLoreFolder(store, owner, removal);
    expect(store.get('character', owner.id)?.value.loreFolders).toEqual([{ id: 'sea', name: '바다' }]);
    expect(store.get('lore', inside.id)?.value.folder).toBe('sea');
  });
});
