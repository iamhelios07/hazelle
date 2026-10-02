import type { ImportedModule } from '../engine/import/types';
import type { Stored } from '../model/kinds';
import type { Module } from '../model/library';
import type { ApiResult } from './api';
import { saveAssets, type Progress } from './characters';
import type { Files } from './files';
import { without, type ObjectStore, type Write } from './store';

// A module as the importer read it (design §6.5). Its pictures are stored first; then it is written with its lorebook
// and assets in one batch, itself last, so a module appears only once whole. brought: a move from Risu's, with its
// Risu id and the id the move already turned on. skipped: its pictures that were not kept.
export async function importModule(store: ObjectStore, files: Files, imported: ImportedModule, progress: Progress, brought?: { id: string; risu: string }): Promise<ApiResult<{ id: string; skipped: number }>> {
  const stored = await saveAssets(files, imported.assets, progress);
  if (!stored.ok) return stored;
  const id = brought?.id ?? crypto.randomUUID();
  const folders = imported.loreFolders.map((name) => ({ id: crypto.randomUUID(), name }));
  const { name, description, namespace } = imported;
  const module: Module = { ...imported.pack, name, description, namespace, loreFolders: folders, ...(brought && { risu: brought.risu }) };
  const writes: Write[] = [
    { type: 'create', kind: 'module', id, parent: null, value: module },
    ...stored.data.kept.map((asset): Write => ({ type: 'create', kind: 'asset', id: crypto.randomUUID(), parent: id, value: asset })),
    ...imported.lore.map((entry): Write => ({ type: 'create', kind: 'lore', id: crypto.randomUUID(), parent: id, value: { ...entry, folder: entry.folder === null ? null : folders[entry.folder]!.id } })),
  ];
  let done = 0;
  progress({ kind: 'saving', done, total: writes.length });
  const saved = await store.batch(writes, () => progress({ kind: 'saving', done: ++done, total: writes.length }));
  return saved.ok ? { ok: true, data: { id, skipped: stored.data.skipped } } : saved;
}

// The modules there are, by name. A deleted one is listed nowhere.
export const modulesOf = (store: Pick<ObjectStore, 'list'>): Stored<'module'>[] =>
  store
    .list('module')
    .filter(({ value }) => value.deleted === undefined)
    .sort((a, b) => a.value.name.localeCompare(b.value.name, 'ko'));

const switched = (ids: string[] | undefined, id: string, on: boolean) => [...(ids ?? []).filter((each) => each !== id), ...(on ? [id] : [])];

// 항상: on in every chat.
export function setModuleAlways(store: ObjectStore, id: string, on: boolean): Promise<ApiResult<Stored<'settings'>>> {
  return store.upsert('settings', (current) => ({ models: {}, ...current, modules: switched(current?.modules, id, on) }));
}

// On in one character's chats.
export function setCharacterModule(store: ObjectStore, character: string, id: string, on: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', character, (current) => ({ ...current, modules: switched(current.modules, id, on) }));
}

// at is when it was deleted: it is off everywhere at once, and removed for good with what it owns KEEP_DELETED later
// (purgeExpired); null brings it back as it was, on where it was on.
export function setModuleDeleted(store: ObjectStore, id: string, at: number | null): Promise<ApiResult<Stored<'module'>>> {
  return store.update('module', id, (current) => (at === null ? without(current, 'deleted') : { ...current, deleted: at }));
}
