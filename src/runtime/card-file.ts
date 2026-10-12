import { writeCharx } from '../engine/import/card';
import type { Bot, Imported, Profiles } from '../engine/import/types';
import { zipWriter } from '../engine/import/zip';
import { live, type LoreFolder } from '../model/library';
import { likenessId } from '../model/likeness';
import type { ApiResult } from './api';
import type { BackupOutput } from './backup-zip';
import { importCharacter, type ImportedCharacter, type Progress } from './characters';
import type { Files } from './files';
import { importModule } from './modules';
import type { ObjectStore } from './store';
import type { FileRef } from '../vault/files';

// Read and written in order this many at a time, as a backup's are, so a bot of thousands never holds them all at once.
const PICTURE_WINDOW = 12;

export type ExportStep = { done: number; total: number };

// A 삽화 profile's receipt is the exporting account's usage, which another account's 사용량 must not count.
const profilesOf = (store: ObjectStore, owner: string): Profiles | null => {
  const likeness = store.get('likeness', likenessId(owner))?.value;
  return likeness ? { portraits: likeness.portraits, at: likeness.at } : null;
};

function owned(store: ObjectStore, owner: string, folders: LoreFolder[]) {
  const ids = folders.map(({ id }) => id);
  const pictures = store.children('asset', owner).map(({ value }) => value);
  return {
    lore: store.children('lore', owner).map(({ value }) => ({ ...value, folder: value.folder === null || !ids.includes(value.folder) ? null : ids.indexOf(value.folder) })),
    loreFolders: folders.map(({ name }) => name),
    assets: pictures.map(({ name, type }) => ({ name, type })),
    files: pictures.map(({ file }) => file),
    likeness: profilesOf(store, owner),
  };
}

// 내보내기: a character as a CCv3 charx that Risu and this app both read (engine/import/card writeCharx), with the
// modules on for it in the module list. A module holding a tool is left out, as Risu cannot run it, and counted. Its chats, its
// persona, connections, settings, and what only tells this account's copy apart (별명, folder, its Risu id, the answers
// it was given, its own switches) stay. A picture that cannot be read stops the export: the card already names it.
export async function exportCharacter(store: ObjectStore, files: Files, id: string, output: BackupOutput, progress: (step: ExportStep) => void): Promise<ApiResult<{ tools: number }>> {
  const character = live(store.get('character', id))?.value;
  if (!character) return { ok: false, error: 'gone' };
  const own = owned(store, id, character.loreFolders);
  let tools = 0;
  const modules = (character.modules ?? []).flatMap((module) => {
    const stored = live(store.get('module', module));
    if (!stored) return [];
    if (store.children('tool', module).length > 0) {
      tools++;
      return [];
    }
    const { risu, name, description, namespace, loreFolders, regex, triggers, background, toggles } = stored.value;
    return [{ risu: risu ?? module, name, description, namespace, pack: { regex, triggers, ...(background !== undefined && { background }), toggles }, ...owned(store, module, loreFolders) }];
  });
  const avatar = store.children('avatar', id)[0]?.value ?? null;
  const { translatorNote, keepThoughts, statusScripts, translations } = character;
  const bot: Bot = {
    card: character.card,
    lore: own.lore,
    loreFolders: own.loreFolders,
    avatar: avatar?.type ?? null,
    assets: own.assets,
    own: { character: { translatorNote, keepThoughts, statusScripts, translations }, likeness: own.likeness },
    bundled: modules,
  };
  const refs: FileRef[] = [...(avatar ? [avatar.file] : []), ...own.files, ...modules.flatMap((module) => module.files)];
  const { files: entries, pictures } = writeCharx(bot);
  const zip = zipWriter((bytes) => output.write(bytes));
  let complete = false;
  try {
    for (const { path, bytes } of entries) await zip.add(path, bytes, true);
    for (let start = 0; start < refs.length; start += PICTURE_WINDOW) {
      progress({ done: start, total: refs.length });
      const read = await Promise.all(refs.slice(start, start + PICTURE_WINDOW).map((ref) => files.read(ref)));
      for (const [index, bytes] of read.entries()) {
        if (!bytes.ok) return bytes;
        // Pictures are compressed already.
        await zip.add(pictures[start + index]!, bytes.data);
      }
    }
    await zip.end();
    await output.close();
    complete = true;
    return { ok: true, data: { tools } };
  } catch {
    return { ok: false, error: 'export-write' };
  } finally {
    if (!complete) await output.abort();
  }
}

// A card file's character, after the modules it bundles: one already here and not deleted, by the id module files name
// it by (as a move finds Risu's), is turned on rather than brought again, so bots that share a module share one.
export async function importCardFile(store: ObjectStore, files: Files, imported: Imported, progress: Progress): Promise<ApiResult<ImportedCharacter>> {
  const here = new Map(store.list('module').flatMap(({ id, value }) => (value.deleted === undefined && value.risu !== undefined ? [[value.risu, id]] : [])));
  const on: string[] = [];
  let skipped = 0;
  for (const module of imported.bundled) {
    const found = module.risu === null ? undefined : (here.get(module.risu) ?? live(store.get('module', module.risu))?.id);
    if (found !== undefined) {
      on.push(found);
      continue;
    }
    const saved = await importModule(store, files, module, progress, module.risu === null ? undefined : { id: crypto.randomUUID(), risu: module.risu });
    if (!saved.ok) return saved;
    on.push(saved.data.id);
    skipped += saved.data.skipped;
  }
  const saved = await importCharacter(store, files, imported, imported.avatar, progress, undefined, on);
  return saved.ok ? { ok: true, data: { ...saved.data, skipped: saved.data.skipped + skipped } } : saved;
}
