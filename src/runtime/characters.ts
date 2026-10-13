import { blankCard, imageType } from '../engine/import/card';
import type { Card, Imported, Pack, Picture } from '../engine/import/types';
import type { Translation, TranslateSwitches } from '../model/chat';
import type { IllustrateSwitches } from '../model/illustration';
import type { Stored, Values } from '../model/kinds';
import { holds, nest, readableTexts, type Asset, type Avatar, type Character, type Lore, type Pictures } from '../model/library';
import { likenessId, type Likeness } from '../model/likeness';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import type { Files } from './files';
import { thumbnail } from './picture';
import { markDeleted } from './removal';
import { allWritten } from './api';
import { without } from '../model/fields';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';

export type Progress = (step: { kind: 'picture' } | { kind: 'assets' | 'saving'; done: number; total: number }) => void;

type Owned = { avatar: Avatar | null; assets: Asset[]; lore: Lore[]; likeness: Likeness | null };

// Files are read and sent this many at a time, so a bot of thousands never holds them all at once.
const FILE_WINDOW = 32;

// The character goes last with what it owns (store.batch), a move's chat roots right before it, so a failure midway
// never leaves a character missing some of its own, which a move relies on to skip a character already brought. A batch
// over one request is cut from the back (store.commit), so the roots go in the character's request; only 200 or more
// chats, or roots pushed past the request's byte limit, leave some roots without their character when cut there. id,
// chats: a move's character id, which its staged entries name, and its chat roots. unheld: a move holds those chats
// itself and summarizes them together once the character is published (runtime/move).
export async function addCharacter(store: ObjectStore, character: Character, { avatar, assets, lore, likeness }: Owned, progress: Progress, { id = crypto.randomUUID(), chats = [] }: { id?: string; chats?: Write[] } = {}): Promise<ApiResult<string>> {
  const owned = <K extends 'avatar' | 'asset' | 'lore'>(kind: K, value: Values[K]): Write => ({ type: 'create', kind, id: crypto.randomUUID(), parent: id, value });
  const writes: Write[] = [
    { type: 'create', kind: 'character', id, parent: null, value: character },
    ...(avatar ? [owned('avatar', avatar)] : []),
    ...assets.map((asset) => owned('asset', asset)),
    ...lore.map((entry) => owned('lore', entry)),
    ...(likeness ? [{ type: 'create' as const, kind: 'likeness' as const, id: likenessId(id), parent: id, value: likeness }] : []),
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

// typeOf: what a kept file is, null for one not kept; an inlay alone also keeps a signature (engine/import inlayType).
export async function saveAssets(files: Files, assets: Imported['assets'], progress: Progress, typeOf: (bytes: Uint8Array) => string | null = imageType): Promise<ApiResult<{ kept: Asset[]; skipped: number }>> {
  const kept: Asset[] = [];
  let skipped = 0;
  for (let start = 0; start < assets.length; start += FILE_WINDOW) {
    progress({ kind: 'assets', done: start, total: assets.length });
    const window = await Promise.all(assets.slice(start, start + FILE_WINDOW).map(async ({ name, read }) => ({ name, bytes: await read() })));
    const read = window.flatMap(({ name, bytes }) => {
      const type = bytes && typeOf(bytes);
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

// A picture whose thumbnail cannot be made, and one the server refuses: too large, blocked, or past the account's
// picture cap (runtime/files Files.save).
const FACELESS = new Set(['picture-unreadable', 'picture-refused']);

async function savedAvatar(files: Files, picture: Picture): Promise<ApiResult<Avatar>> {
  const thumb = await thumbnail(picture).catch(() => null);
  if (thumb === null) return { ok: false, error: 'picture-unreadable' };
  const saved = await files.save([picture.bytes]);
  if (!saved.ok) return saved;
  const [file] = saved.data;
  return file ? { ok: true, data: { type: picture.type, size: picture.bytes.length, thumb, file } } : { ok: false, error: 'picture-refused' };
}

// The old file stays stored: nothing removes a file while its account lives, since a copy (copyCharacter) or a backup
// may still name it.
export async function setAvatar(store: ObjectStore, files: Files, id: string, bytes: Uint8Array<ArrayBuffer>): Promise<ApiResult<Stored<'avatar'>>> {
  if (!store.get('character', id)) return { ok: false, error: 'gone' };
  const type = imageType(bytes);
  if (!type) return { ok: false, error: 'picture-unreadable' };
  const saved = await savedAvatar(files, { bytes, type });
  if (!saved.ok) return saved;
  const held = store.children('avatar', id)[0];
  return held ? store.update('avatar', held.id, () => saved.data) : store.create('avatar', saved.data, { parent: id });
}

// owner: the character or module the pictures join, each named by its file's name without the extension.
export async function addAssets(store: ObjectStore, files: Files, owner: string, picked: Pick<File, 'name' | 'arrayBuffer'>[]): Promise<ApiResult<{ added: number; skipped: number }>> {
  const assets = picked.map((file) => ({ name: file.name.replace(/\.[^.]+$/, '') || file.name, read: async () => new Uint8Array(await file.arrayBuffer()) }));
  const saved = await saveAssets(files, assets, () => {});
  if (!saved.ok) return saved;
  const { kept, skipped } = saved.data;
  const written = await store.batch(kept.map((asset): Write => ({ type: 'create', kind: 'asset', id: crypto.randomUUID(), parent: owner, value: asset })));
  return written.ok ? { ok: true, data: { added: kept.length, skipped } } : written;
}

export const renameAsset = (store: ObjectStore, id: string, name: string) => store.update('asset', id, (current) => ({ ...current, name }));
// The file stays stored, as for setAvatar.
export const removeAsset = (store: ObjectStore, id: string) => store.take('asset', id);
export const restoreAsset = (store: ObjectStore, removed: Stored<'asset'>) => store.restore(removed);

// A moved character's id is already named by its staged entries; chats: their roots (runtime/chat-log chatWrites).
export type Brought = { id: string; folder: string | null; risu: string; modules: string[]; chats: Write[] };

// modules: those on for it, a card file's bundled ones, saved before it (runtime/card-file).
export async function importCharacter(
  store: ObjectStore,
  files: Files,
  { card, lore, loreFolders, assets, own = null }: Pick<Imported, 'card' | 'lore' | 'loreFolders' | 'assets'> & Partial<Pick<Imported, 'own'>>,
  picture: Picture | null,
  progress: Progress,
  brought?: Brought,
  modules: string[] = [],
): Promise<ApiResult<ImportedCharacter>> {
  let avatar: Avatar | null = null;
  if (picture) {
    progress({ kind: 'picture' });
    const saved = await savedAvatar(files, picture);
    if (!saved.ok && !FACELESS.has(saved.error)) return saved;
    if (saved.ok) avatar = saved.data;
  }
  const stored = await saveAssets(files, assets, progress);
  if (!stored.ok) return stored;
  const { kept, skipped } = stored.data;
  const folders = loreFolders.map((name) => ({ id: crypto.randomUUID(), name }));
  const entries = lore.map((entry) => ({ ...entry, folder: entry.folder === null ? null : folders[entry.folder]!.id }));
  const on = brought?.modules ?? modules;
  const character: Character = { card, folder: brought?.folder ?? null, loreFolders: folders, ...own?.character, ...(brought && { risu: brought.risu }), ...(on.length > 0 && { modules: on }) };
  const likeness = own?.likeness ? { ...own.likeness, receipt: null } : null;
  const added = await addCharacter(store, character, { avatar, assets: kept, lore: entries, likeness }, progress, brought && { id: brought.id, chats: brought.chats });
  return added.ok ? { ok: true, data: { id: added.data, skipped, faceless: picture !== null && avatar === null } } : added;
}

// 사본 만들기: chats stay with the original, and so does the alias, which tells the two apart. The copy names the same
// stored files, so it keeps the 삽화 profiles made from them, tag edits included, without another call.
export async function copyCharacter(store: ObjectStore, id: string, name: string, progress: Progress): Promise<ApiResult<string>> {
  const failed = await store.pull();
  if (failed) return failed;
  const original = store.get('character', id)?.value;
  if (!original) return { ok: false, error: 'gone' };
  const owned = {
    avatar: store.children('avatar', id)[0]?.value ?? null,
    assets: store.children('asset', id).map((asset) => asset.value),
    lore: store.children('lore', id).map((entry) => entry.value),
    likeness: store.get('likeness', likenessId(id))?.value ?? null,
  };
  return addCharacter(store, { ...without(original, 'alias'), card: { ...original.card, name }, origin: { id, name: original.card.name } }, owned, progress);
}

export const createCharacter = (store: ObjectStore, name: string, id: string) =>
  addCharacter(store, { card: blankCard(name), folder: null, loreFolders: [] }, { avatar: null, assets: [], lore: [], likeness: null }, () => {}, { id });

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

export function setStatusScript(store: ObjectStore, id: string, script: string, on: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => {
    const rest = (current.statusScripts ?? []).filter((each) => each !== script);
    return { ...current, statusScripts: on ? [...rest, script] : rest };
  });
}

export function setKeepThoughts(store: ObjectStore, id: string, keep: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', id, (current) => (keep ? { ...current, keepThoughts: true } : without(current, 'keepThoughts')));
}

// A toggle's value for a character's chats, or with character null for 캐릭터 없이's.
export function setToggle(store: ObjectStore, character: string | null, key: string, value: string): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  if (character === null) return store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, toggles: { ...current.toggles, [key]: value } }));
  return store.update('character', character, (current) => ({ ...current, toggles: { ...current.toggles, [key]: value } }));
}

// What a switch not stored reads as. Switches stored before 반전 모드, the languages and the prompt choice existed
// hold none of those, and read as these.
const TRANSLATE_DEFAULTS = { replies: false, input: false, reverse: false, replyLanguage: 'Korean', inputLanguage: 'English' };

// 번역's and 삽화's switches: shared by every chat (Settings), or a character's own copy in their place (캐릭터별 설정).
const OWN = { translate: 'ownTranslate', illustrate: 'ownIllustrate' } as const;
type Scoped = keyof typeof OWN;
type SwitchesOf = { translate: TranslateSwitches; illustrate: IllustrateSwitches };
// What a write stores: the switches held, with a translation's required ones filled.
const FILL: { [S in Scoped]: (saved: SwitchesOf[S] | undefined, change?: Partial<SwitchesOf[S]>) => SwitchesOf[S] } = {
  translate: (saved, change = {}) => ({ replies: TRANSLATE_DEFAULTS.replies, input: TRANSLATE_DEFAULTS.input, ...saved, ...change }),
  illustrate: (saved, change = {}) => ({ ...saved, ...change }),
};

function scoped<S extends Scoped>(store: Pick<ObjectStore, 'get'>, character: string | null, scope: S): { switches: SwitchesOf[S] | undefined; own: boolean } {
  const own = character === null ? undefined : (store.get('character', character)?.value[OWN[scope]] as SwitchesOf[S] | undefined);
  return { switches: own ?? (store.get('settings', SETTINGS_ID)?.value[scope] as SwitchesOf[S] | undefined), own: own !== undefined };
}

// Only the switches given, merged into the ones a chat of character reads: its own, or else the shared ones. A field
// given as undefined goes back to its default.
function setScoped<S extends Scoped>(store: ObjectStore, character: string | null, scope: S, change: Partial<SwitchesOf[S]>): Promise<ApiResult<Stored<'character'> | Stored<'settings'>>> {
  const fill = FILL[scope] as (saved: SwitchesOf[S] | undefined, change?: Partial<SwitchesOf[S]>) => SwitchesOf[S];
  const own = OWN[scope];
  if (character !== null && store.get('character', character)?.value[own]) {
    return store.update('character', character, (current) => ({ ...current, [own]: fill(current[own] as SwitchesOf[S], change) }));
  }
  return store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, [scope]: fill(current[scope] as SwitchesOf[S] | undefined, change) }));
}

// On starts from the shared switches as they are; off follows them again.
function setOwnScoped<S extends Scoped>(store: ObjectStore, character: string, scope: S, own: boolean): Promise<ApiResult<Stored<'character'>>> {
  const fill = FILL[scope] as (saved: SwitchesOf[S] | undefined) => SwitchesOf[S];
  const copy = fill(store.get('settings', SETTINGS_ID)?.value[scope] as SwitchesOf[S] | undefined);
  return store.update('character', character, (current) => (own ? { ...current, [OWN[scope]]: copy } : without(current, OWN[scope])));
}

// The switches in effect for a chat of character. input is off under reverse, whatever is stored, since 반전 모드 sends
// what the user typed. prompt absent follows the account's default translation prompt.
export type TranslateSetup = typeof TRANSLATE_DEFAULTS & Pick<TranslateSwitches, 'prompt'> & { own: boolean };

export function translateSwitches(store: Pick<ObjectStore, 'get'>, character: string | null): TranslateSetup {
  const { switches: held, own } = scoped(store, character, 'translate');
  const switches = { ...TRANSLATE_DEFAULTS, ...held };
  return { ...switches, input: switches.input && !switches.reverse, own };
}

export const setTranslate = (store: ObjectStore, character: string | null, change: Partial<TranslateSwitches>) => setScoped(store, character, 'translate', change);

export const setOwnTranslate = (store: ObjectStore, character: string, own: boolean) => setOwnScoped(store, character, 'translate', own);

// Absent auto and spend are off.
export type IllustrateSetup = Omit<IllustrateSwitches, 'auto' | 'spend'> & { auto: boolean; spend: boolean; own: boolean };

export function illustrateSwitches(store: Pick<ObjectStore, 'get'>, character: string | null): IllustrateSetup {
  const { switches, own } = scoped(store, character, 'illustrate');
  return { ...switches, auto: switches?.auto ?? false, spend: switches?.spend ?? false, own };
}

export const setIllustrate = (store: ObjectStore, character: string | null, change: Partial<IllustrateSwitches>) => setScoped(store, character, 'illustrate', change);

export const setOwnIllustrate = (store: ObjectStore, character: string, own: boolean) => setOwnScoped(store, character, 'illustrate', own);

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
  if (character === null) return store.upsert('settings', (current = EMPTY_SETTINGS) => noted(current));
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
  if (character === null) return store.upsert('settings', (current = EMPTY_SETTINGS) => without(current, 'toggles'));
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
