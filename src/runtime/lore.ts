import { DEFAULT_ORDER } from '../engine/import/convert';
import type { Stored } from '../model/kinds';
import type { Lore, LoreFolder } from '../model/library';
import type { ApiResult } from './api';
import type { ObjectStore } from './store';

export type LoreOwner = { kind: 'character' | 'module'; id: string };

export const newLore = (siblings: Lore[], folder: string | null): Lore => ({
  name: '',
  keys: [],
  secondaryKeys: [],
  content: '',
  enabled: true,
  constant: false,
  selective: false,
  useRegex: false,
  caseSensitive: false,
  insertionOrder: siblings.length ? Math.max(...siblings.map((entry) => entry.insertionOrder)) + 1 : DEFAULT_ORDER,
  priority: null,
  position: null,
  folder,
});

// id: the caller's, so the screen knows the entry before it is stored.
export const addLore = (store: ObjectStore, owner: string, folder: string | null, id: string): Promise<ApiResult<Stored<'lore'>>> =>
  store.create('lore', newLore(store.children('lore', owner).map(({ value }) => value), folder), { id, parent: owner });

// Only the fields given, so an edit to another field on another device survives.
export const editLore = (store: ObjectStore, id: string, patch: Partial<Lore>): Promise<ApiResult<Stored<'lore'>>> =>
  store.update('lore', id, (current) => ({ ...current, ...patch }));

// Lore has no 휴지통: it goes at once, and the toast's 되돌리기 writes it back under its id.
export const removeLore = (store: ObjectStore, id: string) => store.take('lore', id);
export const restoreLore = (store: ObjectStore, removed: Stored<'lore'>) => store.restore(removed);

function setFolders(store: ObjectStore, { kind, id }: LoreOwner, change: (folders: LoreFolder[]) => LoreFolder[]): Promise<ApiResult<unknown>> {
  return kind === 'character'
    ? store.update('character', id, (current) => ({ ...current, loreFolders: change(current.loreFolders) }))
    : store.update('module', id, (current) => ({ ...current, loreFolders: change(current.loreFolders) }));
}

export const addLoreFolder = (store: ObjectStore, owner: LoreOwner, name: string) => setFolders(store, owner, (folders) => [...folders, { id: crypto.randomUUID(), name }]);

export const renameLoreFolder = (store: ObjectStore, owner: LoreOwner, folder: string, name: string) =>
  setFolders(store, owner, (folders) => folders.map((each) => (each.id === folder ? { ...each, name } : each)));

export type RemovedLoreFolder = { folder: LoreFolder; at: number; entries: string[] };

async function place(store: ObjectStore, entries: string[], folder: string | null): Promise<ApiResult<null>> {
  for (const id of entries) {
    const saved = await store.update('lore', id, (current) => ({ ...current, folder }));
    if (!saved.ok) return saved;
  }
  return { ok: true, data: null };
}

// Its entries move out of every folder first, so none is left naming a folder that is gone.
export async function removeLoreFolder(store: ObjectStore, owner: LoreOwner, id: string): Promise<ApiResult<RemovedLoreFolder>> {
  const folders = store.get(owner.kind, owner.id)?.value.loreFolders ?? [];
  const at = folders.findIndex((each) => each.id === id);
  const folder = folders[at];
  if (!folder) return { ok: false, error: 'gone' };
  const entries = store.children('lore', owner.id).filter(({ value }) => value.folder === folder.id).map(({ id }) => id);
  const moved = await place(store, entries, null);
  if (!moved.ok) return moved;
  const removed = await setFolders(store, owner, (folders) => folders.filter((each) => each.id !== folder.id));
  return removed.ok ? { ok: true, data: { folder, at, entries } } : removed;
}

export async function restoreLoreFolder(store: ObjectStore, owner: LoreOwner, { folder, at, entries }: RemovedLoreFolder): Promise<ApiResult<null>> {
  const restored = await setFolders(store, owner, (folders) => folders.toSpliced(at, 0, folder));
  return restored.ok ? place(store, entries, folder.id) : restored;
}
