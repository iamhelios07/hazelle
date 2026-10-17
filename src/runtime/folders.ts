import { filedIn, holds, nest, withInside, type Filed } from '../model/folders';
import type { Stored, Values } from '../model/kinds';
import { without } from '../model/fields';
import { allWritten } from './api';
import type { ObjectStore } from './store';

type Placement = { id: string; folder: string | null };

const folderOf = (value: Values[Filed]) => ('folder' in value ? (value.folder ?? null) : null);

// A character names no folder with null; the other kinds leave the field out.
function place(store: ObjectStore, kind: Filed, placements: Placement[]) {
  return allWritten(placements.map(({ id, folder }) => {
    if (kind === 'character') return store.update('character', id, (current) => ({ ...current, folder }));
    if (kind === 'prompt') return store.update('prompt', id, (current) => (current.task !== undefined ? current : folder === null ? without(current, 'folder') : { ...current, folder }));
    if (kind === 'module') return store.update('module', id, (current) => (folder === null ? without(current, 'folder') : { ...current, folder }));
    return store.update('persona', id, (current) => (folder === null ? without(current, 'folder') : { ...current, folder }));
  }));
}

export const moveInto = (store: ObjectStore, kind: Filed, ids: string[], folder: string | null) => place(store, kind, ids.map((id) => ({ id, folder })));

export const createFolder = (store: ObjectStore, kind: Filed, name: string, parent: string | null) =>
  store.create('folder', { name, ...(parent !== null && { parent }), ...(kind !== 'character' && { of: kind }) });

export const renameFolder = (store: ObjectStore, id: string, name: string) => store.update('folder', id, (current) => ({ ...current, name }));

// What removeFolder writes and restoreFolder undoes, and up, the folder the removed one sat in, where its things move
// to (null: out of every folder).
export type RemovedFolder = { kind: Filed; folders: Stored<'folder'>[]; placements: Placement[]; up: Stored<'folder'> | null };

// A folder goes with the folders inside it, and its things, those in 휴지통 too, move up a level. Both go at once: a
// thing left naming a gone folder sits in no folder (model/folders indexFolders). null: the folder is gone.
export function folderRemoval(store: ObjectStore, id: string): RemovedFolder | null {
  const stored = store.get('folder', id);
  if (!stored) return null;
  const kind = filedIn(stored.value);
  const every = nest(store.list('folder'), kind).flatMap(withInside);
  const target = every.find((folder) => folder.id === id);
  if (!target) return null;
  const up = every.find((folder) => folder.children.includes(target)) ?? null;
  const things: Stored<Filed>[] = store.list(kind);
  const placements = things.filter(({ value }) => holds(target, folderOf(value))).map(({ id, value }) => ({ id, folder: folderOf(value) }));
  return { kind, folders: withInside(target), placements, up };
}

export const removeFolder = (store: ObjectStore, { kind, folders, placements, up }: RemovedFolder) =>
  allWritten([place(store, kind, placements.map(({ id }) => ({ id, folder: up?.id ?? null }))), store.batch(folders.map(({ id }) => ({ type: 'remove', id })))]);

export const restoreFolder = (store: ObjectStore, { kind, folders, placements }: RemovedFolder) =>
  allWritten([store.batch(folders.map(({ id, kind, parent, value }) => ({ type: 'restore', id, kind, parent, value }))), place(store, kind, placements)]);
