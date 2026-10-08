import { imageType } from '../engine/import/card';
import type { Card, Imported, Pack, Picture } from '../engine/import/types';
import type { Translation, TranslateSwitches } from '../model/chat';
import type { IllustrateSwitches } from '../model/illustration';
import type { Stored, Values } from '../model/kinds';
import { holds, nest, readableTexts, type Asset, type Avatar, type Character, type Lore, type Pictures } from '../model/library';
import { SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { Files } from './files';
import { thumbnail } from './picture';
import { markDeleted } from './removal';
import { allWritten } from './api';
import { without } from '../model/fields';
import type { ObjectStore, Write } from './store';

export type Progress = (step: { kind: 'picture' } | { kind: 'assets' | 'saving'; done: number; total: number }) => void;

type Owned = { avatar: Avatar | null; assets: Asset[]; lore: Lore[] };

// Files are read and sent this many at a time, so a bot of thousands never holds them all at once.
const FILE_WINDOW = 32;

// The character goes last with what it owns (store.batch), a move's chat roots right before it, so a failure midway
// never leaves a character missing some of its own, which a move relies on to skip a character already brought. A batch
// over one request is cut from the back (store.commit), so the roots go in the character's request; only 200 or more
// chats, or roots pushed past the request's byte limit, leave some roots without their character when cut there. brought: a move's character id, which its staged entries name, and its chat roots. unheld: a move holds
// those chats itself and summarizes them together once the character is published (runtime/move).
export async function addCharacter(store: ObjectStore, character: Character, { avatar, assets, lore }: Owned, progress: Progress, { id = crypto.randomUUID(), chats = [] }: { id?: string; chats?: Write[] } = {}): Promise<ApiResult<string>> {
  const owned = <K extends 'avatar' | 'asset' | 'lore'>(kind: K, value: Values[K]): Write => ({ type: 'create', kind, id: crypto.randomUUID(), parent: id, value });
  const writes: Write[] = [
    { type: 'create', kind: 'character', id, parent: null, value: character },
    ...(avatar ? [owned('avatar', avatar)] : []),
    ...assets.map((asset) => owned('asset', asset)),
    ...lore.map((entry) => owned('lore', entry)),
    ...chats,
  ];
  let done = 0;
  progress({ kind: 'saving', done, total: writes.length });
  const result = await store.batch(writes, () => progress({ kind: 'saving', done: ++done, total: writes.length }), { unheld: true });
  return result.ok ? { ok: true, data: id } : result;
}

// skipped: assets not kept, as not a picture this app reads or too large to store.
// Both import entrances use faceless for thumbnail failures and refused uploads, not absent source pictures.
export type ImportedCharacter = { id: string; skipped: number; faceless: boolean };

export async function saveAssets(files: Files, assets: Imported['assets'], progress: Progress): Promise<ApiResult<{ kept: Asset[]; skipped: number }>> {
  const kept: Asset[] = [];
  let skipped = 0;
  for (let start = 0; start < assets.length; start += FILE_WINDOW) {
    progress({ kind: 'assets', done: start, total: assets.length });
    const window = await Promise.all(assets.slice(start, start + FILE_WINDOW).map(async ({ name, read }) => ({ name, bytes: await read() })));
    const read = window.flatMap(({ name, bytes }) => {
      const type = bytes && imageType(bytes);
      if (!type) skipped++;
      return type ? [{ name, type, bytes: bytes! }] : [];
    });
    const saved = await files.save(read.map(({ bytes }) => bytes));
    if (!saved.ok) return saved;
    read.forEach(({ name, type, bytes }, index) => {
      const file = saved.data[index];
      if (file) kept.push({ name, type, size: bytes.length, file });
      else skipped++;
    });
  }
  if (assets.length) progress({ kind: 'assets', done: assets.length, total: assets.length });
  return { ok: true, data: { kept, skipped } };
}

// A moved character's id is already named by its staged entries; chats: their roots (runtime/chat-log chatWrites).
export type Brought = { id: string; folder: string | null; risu: string; modules: string[]; chats: Write[] };

export async function importCharacter(
  store: ObjectStore,
  files: Files,
  { card, lore, loreFolders, assets }: Pick<Imported, 'card' | 'lore' | 'loreFolders' | 'assets'>,
  picture: Picture | null,
  progress: Progress,
  brought?: Brought,
): Promise<ApiResult<ImportedCharacter>> {
  let avatar: Avatar | null = null;
  if (picture) {
    progress({ kind: 'picture' });
    const thumb = await thumbnail(picture).catch(() => null);
    if (thumb !== null) {
      const saved = await files.save([picture.bytes]);
      if (!saved.ok) return saved;
      const [file] = saved.data;
      if (file) avatar = { type: picture.type, size: picture.bytes.length, thumb, file };
    }
  }
  const stored = await saveAssets(files, assets, progress);
  if (!stored.ok) return stored;
  const { kept, skipped } = stored.data;
  const folders = loreFolders.map((name) => ({ id: crypto.randomUUID(), name }));
  const entries = lore.map((entry) => ({ ...entry, folder: entry.folder === null ? null : folders[entry.folder]!.id }));
  const character: Character = { card, folder: brought?.folder ?? null, loreFolders: folders, ...(brought && { risu: brought.risu, ...(brought.modules.length > 0 && { modules: brought.modules }) }) };
  const added = await addCharacter(store, character, { avatar, assets: kept, lore: entries }, progress, brought && { id: brought.id, chats: brought.chats });
  return added.ok ? { ok: true, data: { id: added.data, skipped, faceless: picture !== null && avatar === null } } : added;
}

// 사본 만들기: chats stay with the original, and so does the alias, which tells the two apart. The copy names the same
// stored files.
export async function copyCharacter(store: ObjectStore, id: string, name: string, progress: Progress): Promise<ApiResult<string>> {
  const failed = await store.pull();
  if (failed) return failed;
  const original = store.get('character', id)?.value;
  if (!original) return { ok: false, error: 'gone' };
  const owned = {
    avatar: store.children('avatar', id)[0]?.value ?? null,
    assets: store.children('asset', id).map((asset) => asset.value),
    lore: store.children('lore', id).map((entry) => entry.value),
  };
  return addCharacter(store, { ...without(original, 'alias'), card: { ...original.card, name }, origin: { id, name: original.card.name } }, owned, progress);
}

export const setDeleted = (store: ObjectStore, id: string, at: number | null) => markDeleted(store, 'character', id, at);

export type CharacterText = Omit<Card, keyof Pack> & { alias: string };

// Only the fields given, the card's merged into the current card, so an edit to another field on another device
// survives.
export function editCharacter(store: ObjectStore, id: string, { alias, ...card }: Partial<CharacterText>): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => ({ ...current, ...(alias === undefined ? {} : { alias }), card: { ...current.card, ...card } }));
}

// Only the fields given; undefined removes one, back to its default.
export function setPictures(store: ObjectStore, id: string, patch: Partial<Pictures>): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => {
    const pictures = Object.fromEntries(Object.entries({ ...current.pictures, ...patch }).filter(([, value]) => value !== undefined));
    return Object.keys(pictures).length ? { ...current, pictures } : without(current, 'pictures');
  });
}

export function setDecor(store: ObjectStore, id: string, decor: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => ({ ...current, decor }));
}

export function setBotModels(store: ObjectStore, id: string, botModels: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => ({ ...current, botModels }));
}

export function setStatusScript(store: ObjectStore, id: string, script: string, on: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => {
    const rest = (current.statusScripts ?? []).filter((each) => each !== script);
    return { ...current, statusScripts: on ? [...rest, script] : rest };
  });
}

export function setKeepStatus(store: ObjectStore, id: string, keep: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => (keep ? { ...current, keepStatus: true } : without(current, 'keepStatus')));
}

export function setKeepThoughts(store: ObjectStore, id: string, keep: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => (keep ? { ...current, keepThoughts: true } : without(current, 'keepThoughts')));
}

// A toggle's value for a character's chats, or with character null for 캐릭터 없이's.
export function setToggle(store: ObjectStore, character: string | null, key: string, value: string): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character === null) return store.upsert('settings', (current) => ({ models: {}, ...current, toggles: { ...current?.toggles, [key]: value } }));
  return store.update('character', character, (current) => ({ ...current, toggles: { ...current.toggles, [key]: value } }));
}

// What a switch not stored reads as. Switches stored before 반전 모드, the languages and the prompt choice existed
// hold none of those, and read as these.
const TRANSLATE_DEFAULTS = { replies: false, input: false, reverse: false, replyLanguage: 'Korean', inputLanguage: 'English' };

// The switches in effect for a chat of character. input is off under reverse, whatever is stored, since 반전 모드 sends
// what the user typed. prompt absent follows the account's default translation prompt. own: the character's own
// switches (이 캐릭터만 따로) rather than the shared ones.
export type TranslateSetup = typeof TRANSLATE_DEFAULTS & Pick<TranslateSwitches, 'prompt'> & { own: boolean };

export function translateSwitches(store: Pick<ObjectStore, 'get'>, character: string | null): TranslateSetup {
  const own = character === null ? undefined : store.get('character', character)?.value.ownTranslate;
  const switches = { ...TRANSLATE_DEFAULTS, ...(own ?? store.get('settings', SETTINGS_ID)?.value.translate) };
  return { ...switches, input: switches.input && !switches.reverse, own: own !== undefined };
}

const stored = (saved: TranslateSwitches | undefined, change: Partial<TranslateSwitches> = {}): TranslateSwitches => ({ replies: TRANSLATE_DEFAULTS.replies, input: TRANSLATE_DEFAULTS.input, ...saved, ...change });

// Only the switches given, merged into the ones a chat of character reads: its own, or else the shared ones. prompt
// given as undefined goes back to the default.
export function setTranslate(store: ObjectStore, character: string | null, change: Partial<TranslateSwitches>): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character !== null && store.get('character', character)?.value.ownTranslate) {
    return store.update('character', character, (current) => ({ ...current, ownTranslate: stored(current.ownTranslate, change) }));
  }
  return store.upsert('settings', (current) => ({ models: {}, ...current, translate: stored(current?.translate, change) }));
}

// 이 캐릭터만 따로: on starts from the shared switches as they are; off follows them again.
export function setOwnTranslate(store: ObjectStore, character: string, own: boolean): Promise<ApiResult<Stored<'character'>>> {
  const shared = store.get('settings', SETTINGS_ID)?.value.translate;
  return store.update('character', character, (current) => (own ? { ...current, ownTranslate: stored(shared) } : without(current, 'ownTranslate')));
}

// 삽화's switches for a chat of character, or with character null for 캐릭터 없이's. Absent auto is off.
export type IllustrateSetup = Omit<IllustrateSwitches, 'auto'> & { auto: boolean };

export function illustrateSwitches(store: Pick<ObjectStore, 'get'>, character: string | null): IllustrateSetup {
  const switches = character === null ? store.get('settings', SETTINGS_ID)?.value.illustrate : store.get('character', character)?.value.illustrate;
  return { ...switches, auto: switches?.auto ?? false };
}

// Only the switches given are merged in; prompt or model given as undefined goes back to the default.
export function setIllustrate(store: ObjectStore, character: string | null, change: Partial<IllustrateSwitches>): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character === null) return store.upsert('settings', (current) => ({ models: {}, ...current, illustrate: { ...current?.illustrate, ...change } }));
  return store.update('character', character, (current) => ({ ...current, illustrate: { ...current.illustrate, ...change } }));
}

// Until 2026-10-06 every character kept its own switches in translate; the shared ones replaced them (design §6.3), and
// each session drops any left, so a device still on the old code that writes one loses it at the next load. Delete
// once every account has loaded since v0.1.10.
export async function dropCharacterTranslate(store: ObjectStore): Promise<void> {
  const old = store.list('character').filter(({ value }) => 'translate' in value);
  await Promise.all(old.map(({ id }) => store.update('character', id, (current) => without(current as Character & { translate?: unknown }, 'translate'))));
}

// 번역가의 노트 add up: the 전역 one, then the character's. Stored as typed, since trimming an autosave eats the newline
// being typed; read trimmed.
export function translatorNotes(store: ObjectStore, character: string | null): string {
  const global = store.get('settings', SETTINGS_ID)?.value.translatorNote;
  const own = character === null ? undefined : store.get('character', character)?.value.translatorNote;
  return [global, own].map((note) => note?.trim() ?? '').filter(Boolean).join('\n\n');
}

// character null is the 전역 note, unlike setTranslate's null, which is 캐릭터 없이's switches. Blank removes the note.
export function setTranslatorNote(store: ObjectStore, character: string | null, text: string): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  const noted = <T extends { translatorNote?: string }>(current: T): T => (text.trim() ? { ...current, translatorNote: text } : without(current, 'translatorNote'));
  if (character === null) return store.upsert('settings', (current) => noted({ models: {}, ...current }));
  return store.update('character', character, noted);
}

// Drops the translations of texts the card no longer holds.
export function setTextTranslation(store: ObjectStore, character: string, source: string, language: string, translation: Translation) {
  return store.update('character', character, (current) => {
    const held = readableTexts(current.card);
    return {
      ...current,
      translations: [...(current.translations ?? []).filter((each) => held.includes(each.source) && !(each.source === source && each.language === language)), { source, language, translation }],
    };
  });
}

export function resetToggles(store: ObjectStore, character: string | null): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character === null) return store.upsert('settings', (current) => without({ models: {}, ...current }, 'toggles'));
  return store.update('character', character, (current) => without(current, 'toggles'));
}

type Placement = { id: string; folder: string | null };

const place = (store: ObjectStore, placements: Placement[]) => allWritten(placements.map(({ id, folder }) => store.update('character', id, (current) => ({ ...current, folder }))));

export const moveCharacters = (store: ObjectStore, ids: string[], folder: string | null) => place(store, ids.map((id) => ({ id, folder })));

export const createFolder = (store: ObjectStore, name: string, parent: string | null) => store.create('folder', parent ? { name, parent } : { name });

export const renameFolder = (store: ObjectStore, id: string, name: string) => store.update('folder', id, (current) => ({ ...current, name }));

// What removeFolder writes and restoreFolder undoes, and up, the top folder the characters move to (null: out of every
// folder).
export type RemovedFolder = { folders: Stored<'folder'>[]; placements: Placement[]; up: Stored<'folder'> | null };

// A folder goes with the folders inside it, and its characters, those in 휴지통 too, move up a level. Both go at once:
// a character left naming a gone folder sits in no folder (model/library indexFolders). null: the folder is gone.
export function folderRemoval(store: ObjectStore, id: string): RemovedFolder | null {
  const tree = nest(store.list('folder'));
  const target = tree.flatMap((top) => [top, ...top.children]).find((folder) => folder.id === id);
  if (!target) return null;
  const up = tree.find((top) => top.children.includes(target)) ?? null;
  const placements = store.list('character').filter(({ value }) => holds(target, value)).map(({ id, value }) => ({ id, folder: value.folder }));
  return { folders: [target, ...target.children], placements, up };
}

export const removeFolder = (store: ObjectStore, { folders, placements, up }: RemovedFolder) =>
  allWritten([place(store, placements.map(({ id }) => ({ id, folder: up?.id ?? null }))), store.batch(folders.map(({ id }) => ({ type: 'remove', id })))]);

export const restoreFolder = (store: ObjectStore, { folders, placements }: RemovedFolder) =>
  allWritten([store.batch(folders.map(({ id, kind, parent, value }) => ({ type: 'restore', id, kind, parent, value }))), place(store, placements)]);
