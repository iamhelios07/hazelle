import type { Card, Imported } from '../engine/import/types';
import type { TranslateSwitches } from '../model/chat';
import type { Stored } from '../model/kinds';
import { daysLeft, holds, nest, type Character, type Lore } from '../model/library';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { Files } from './files';
import { planRemoval } from './removal';
import { without, type ObjectStore } from './store';

// The picture of a new character: the original goes to its sealed blob, the thumbnail into the avatar
// object beside it.
export type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string; thumb: string };
export type Progress = (step: { kind: 'picture' } | { kind: 'lore'; saved: number; total: number }) => void;

// Lorebook entries are saved, and a purge's files and objects removed, this many at a time: one request
// each, and bots carry hundreds.
const PARALLEL = 8;

// The character is saved last, so it shows up only once its picture and lorebook are in. A failure
// midway leaves pieces nothing points at, never a character missing some of its own.
export async function addCharacter(store: ObjectStore, files: Files, character: Character, lore: Lore[], picture: Picture | null, progress: Progress): Promise<ApiResult<string>> {
  const id = crypto.randomUUID();
  if (picture) {
    progress({ kind: 'picture' });
    const blob = crypto.randomUUID();
    const put = await files.put(blob, picture.bytes);
    if (!put.ok) return put;
    const saved = await store.create('avatar', { type: picture.type, size: picture.bytes.length, thumb: picture.thumb }, { id: blob, parent: id });
    if (!saved.ok) return saved;
  }
  for (let start = 0; start < lore.length; start += PARALLEL) {
    progress({ kind: 'lore', saved: start, total: lore.length });
    const saved = await Promise.all(lore.slice(start, start + PARALLEL).map((entry) => store.create('lore', entry, { parent: id })));
    const failure = saved.find((result) => !result.ok);
    if (failure && !failure.ok) return failure;
  }
  const saved = await store.create('character', character, { id });
  return saved.ok ? { ok: true, data: id } : saved;
}

// A card as the importer read it, in no library folder. Its lorebook folders get ids,
// and each entry names its folder by that id instead of the importer's index.
export function importCharacter(store: ObjectStore, files: Files, { card, lore, loreFolders }: Pick<Imported, 'card' | 'lore' | 'loreFolders'>, picture: Picture | null, progress: Progress): Promise<ApiResult<string>> {
  const folders = loreFolders.map((name) => ({ id: crypto.randomUUID(), name }));
  const entries = lore.map((entry) => ({ ...entry, folder: entry.folder === null ? null : folders[entry.folder]!.id }));
  return addCharacter(store, files, { card, folder: null, loreFolders: folders }, entries, picture, progress);
}

// A copy that goes its own way (사본 만들기): the card under a new name, the lorebook and the picture,
// in the original's folder. Chats stay with the original, and so does the alias, which tells the two apart. The
// picture is copied, not shared, because a blob is sealed to its own id.
export async function copyCharacter(store: ObjectStore, files: Files, id: string, name: string, progress: Progress): Promise<ApiResult<string>> {
  const original = store.get('character', id)?.value;
  if (!original) return { ok: false, error: 'gone' };
  const [avatar] = store.children('avatar', id);
  let picture: Picture | null = null;
  if (avatar) {
    const bytes = await files.get(avatar.id);
    if (!bytes.ok) return bytes;
    picture = { bytes: bytes.data, type: avatar.value.type, thumb: avatar.value.thumb };
  }
  const lore = store.children('lore', id).map((entry) => entry.value);
  return addCharacter(store, files, { ...without(original, 'alias'), card: { ...original.card, name }, origin: { id, name: original.card.name } }, lore, picture, progress);
}

// at is when it went to 지운 캐릭터, where it and its chats wait KEEP_DELETED before going for good
// (purgeExpired); null brings it back.
export function setDeleted(store: ObjectStore, id: string, at: number | null): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => (at === null ? without(current, 'deleted') : { ...current, deleted: at }));
}

// Removes a character for good with everything it owns, in the order of its removal plan. progress counts
// every file and object removed.
export async function purgeCharacter(store: ObjectStore, files: Files, id: string, progress: (removed: number, total: number) => void): Promise<ApiResult<null>> {
  const rounds = planRemoval(store, { kind: 'character', id });
  const total = rounds.reduce((sum, round) => sum + round.length, 0);
  let done = 0;
  for (const round of rounds) {
    for (let start = 0; start < round.length; start += PARALLEL) {
      progress(done, total);
      const batch = round.slice(start, start + PARALLEL);
      const removed = await Promise.all(batch.map(({ from, id }) => (from === 'files' ? files.remove(id) : store.remove(id))));
      const failure = removed.find((result) => !result.ok);
      if (failure && !failure.ok) return failure;
      done += batch.length;
    }
  }
  return { ok: true, data: null };
}

// The session runs it when it opens, on whichever device opens first. One that fails is tried again next
// time. A stop (the vault closing) lets the character under way finish and leaves the rest for next time.
export async function purgeExpired(store: ObjectStore, files: Files, now: number, signal: AbortSignal): Promise<void> {
  for (const { id, value } of store.list('character')) {
    if (signal.aborted) return;
    if (value.deleted !== undefined && daysLeft(value, now) <= 0) await purgeCharacter(store, files, id, () => {});
  }
}

// What 캐릭터 편집 changes: the card's text and the alias beside it.
export type CharacterText = Card & { alias: string };

// Only the fields given, the card's merged into the current card, so an edit to another field on another device
// survives.
export function editCharacter(store: ObjectStore, id: string, { alias, ...card }: Partial<CharacterText>): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => ({ ...current, ...(alias === undefined ? {} : { alias }), card: { ...current.card, ...card } }));
}

// A toggle's value for a character's chats, or with character null for 캐릭터 없이's.
export function setToggle(store: ObjectStore, character: string | null, key: string, value: string): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character === null) return store.upsert('settings', (current) => ({ models: {}, ...current, toggles: { ...current?.toggles, [key]: value } }));
  return store.update('character', character, (current) => ({ ...current, toggles: { ...current.toggles, [key]: value } }));
}

// What a switch not stored reads as. Switches stored before 반전 모드, the languages and the prompt choice existed
// hold none of those, and read as these.
const TRANSLATE_DEFAULTS = { replies: false, input: false, reverse: false, replyLanguage: 'Korean', inputLanguage: 'English' };

// The switches in effect. input is off under reverse, whatever is stored, since 반전 모드 sends what the user typed.
// prompt absent follows the account's default translation prompt.
export type TranslateSetup = typeof TRANSLATE_DEFAULTS & Pick<TranslateSwitches, 'prompt'>;

// A character's 번역, in every chat of it, or that of every 캐릭터 없이 chat, as toggle values are.
export function translateSwitches(store: ObjectStore, character: string | null): TranslateSetup {
  const saved = character === null ? store.get('settings', SETTINGS_ID)?.value.translate : store.get('character', character)?.value.translate;
  const switches = { ...TRANSLATE_DEFAULTS, ...saved };
  return { ...switches, input: switches.input && !switches.reverse };
}

// Only the switches given, merged into the stored ones; prompt given as undefined goes back to the default.
export function setTranslate(store: ObjectStore, character: string | null, change: Partial<TranslateSwitches>): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  const merged = (saved: TranslateSwitches | undefined): TranslateSwitches => ({ replies: TRANSLATE_DEFAULTS.replies, input: TRANSLATE_DEFAULTS.input, ...saved, ...change });
  if (character === null) return store.upsert('settings', (current) => ({ models: {}, ...current, translate: merged(current?.translate) }));
  return store.update('character', character, (current) => ({ ...current, translate: merged(current.translate) }));
}

// 기본값으로 되돌리기: the chats go back to the toggles' declared defaults.
export function resetToggles(store: ObjectStore, character: string | null): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character === null) return store.upsert('settings', (current) => without({ models: {}, ...current }, 'toggles'));
  return store.update('character', character, (current) => without(current, 'toggles'));
}

type Placement = { id: string; folder: string | null };

// One at a time; the first failure stops the rest.
async function place(store: ObjectStore, placements: Placement[]): Promise<ApiResult<null>> {
  for (const { id, folder } of placements) {
    const saved = await store.update('character', id, (current) => ({ ...current, folder }));
    if (!saved.ok) return saved;
  }
  return { ok: true, data: null };
}

export const moveCharacters = (store: ObjectStore, ids: string[], folder: string | null) => place(store, ids.map((id) => ({ id, folder })));

export const createFolder = (store: ObjectStore, name: string, parent: string | null) => store.create('folder', parent ? { name, parent } : { name });

export const renameFolder = (store: ObjectStore, id: string, name: string) => store.update('folder', id, (current) => ({ ...current, name }));

// What restoreFolder needs to undo removeFolder, and up, the top folder the characters moved to (null:
// out of every folder).
export type RemovedFolder = { folders: Stored<'folder'>[]; placements: Placement[]; up: Stored<'folder'> | null };

// A folder goes with the folders inside it, and its characters, those in 지운 캐릭터 too, first move up
// a level, so no character points at a folder that is gone.
export async function removeFolder(store: ObjectStore, id: string): Promise<ApiResult<RemovedFolder>> {
  const tree = nest(store.list('folder'));
  const target = tree.flatMap((top) => [top, ...top.children]).find((folder) => folder.id === id);
  if (!target) return { ok: false, error: 'gone' };
  const up = tree.find((top) => top.children.includes(target)) ?? null;
  const placements = store.list('character').filter(({ value }) => holds(target, value)).map(({ id, value }) => ({ id, folder: value.folder }));
  const moved = await place(store, placements.map(({ id }) => ({ id, folder: up?.id ?? null })));
  if (!moved.ok) return moved;
  const folders = [target, ...target.children];
  for (const gone of [...target.children, target]) {
    const removed = await store.remove(gone.id);
    if (!removed.ok) return removed;
  }
  return { ok: true, data: { folders, placements, up } };
}

// 되돌리기: the folders back under their ids, then every character back where it was.
export async function restoreFolder(store: ObjectStore, { folders, placements }: RemovedFolder): Promise<ApiResult<null>> {
  for (const folder of folders) {
    const saved = await store.restore(folder);
    if (!saved.ok) return saved;
  }
  return place(store, placements);
}
