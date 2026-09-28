import type { Card, LoreEntry } from '../engine/import/types';
import type { ApiResult } from './api';
import { getBlob, putBlob, type OpenVault } from './blobs';
import type { ObjectStore, Stored } from './store';

// folder is the library folder it sits in (design F6); loreFolders only group its lorebook on screen.
// origin is the character it was copied from, named as it was then, so a gone origin can still be named.
export type Character = { card: Card; folder: string | null; loreFolders: LoreFolder[]; origin?: { id: string; name: string } };
export type LoreFolder = { id: string; name: string };

// Kind `lore`, whose parent is the character. folder is the id of one of its loreFolders.
export type Lore = Omit<LoreEntry, 'folder'> & { folder: string | null };

// Two levels deep (design F6): a subfolder's parent is the top folder it sits in, and top folders have
// none. It lives in the sealed body, not the object's parent, so the server never sees the tree.
export type Folder = { name: string; parent?: string };
export type FolderTree = Stored<Folder> & { children: FolderTree[] };

// Kind `avatar`, whose parent is the character: the original picture is the sealed blob that has the
// object's id, and thumb is a small copy that syncs with the objects, so lists need no blob fetch.
export type Avatar = { type: string; size: number; thumb: string };

// A character with its chats, or (id null) the chats that have no character: 캐릭터 없이.
export type Shelf<C> = { id: string | null; character: Character | null; face: string | null; chats: C[]; order: number };
export type CharacterShelf<C> = Shelf<C> & { id: string; character: Character };

type ChatLike = { chat: { character: string | null }; order: number };

// chats come newest first. A character is as recent as its latest chat, or, with none yet, as its own
// last change.
export function shelve<C extends ChatLike>(characters: Stored<Character>[], avatars: Stored<Avatar>[], chats: C[]): { characters: CharacterShelf<C>[]; none: Shelf<C> } {
  const faces = new Map(avatars.map((avatar) => [avatar.parent, avatar.value.thumb]));
  const grouped = new Map<string | null, C[]>();
  for (const item of chats) {
    const own = grouped.get(item.chat.character);
    if (own) own.push(item);
    else grouped.set(item.chat.character, [item]);
  }
  const shelves = characters.map(({ id, rev, value }) => {
    const own = grouped.get(id) ?? [];
    return { id, character: value, face: faces.get(id) ?? null, chats: own, order: own[0]?.order ?? rev };
  });
  const loose = grouped.get(null) ?? [];
  return {
    characters: shelves.sort((a, b) => b.order - a.order),
    none: { id: null, character: null, face: null, chats: loose, order: loose[0]?.order ?? 0 },
  };
}

// Top folders with their subfolders, both by name. A subfolder whose top folder is gone (removed on
// another device meanwhile) stands at the top instead of vanishing.
export function nest(folders: Stored<Folder>[]): FolderTree[] {
  const sorted = [...folders].sort((a, b) => a.value.name.localeCompare(b.value.name, 'ko'));
  const ids = new Set(sorted.map((folder) => folder.id));
  return sorted
    .filter(({ value }) => value.parent === undefined || !ids.has(value.parent))
    .map((top) => ({ ...top, children: sorted.filter(({ value }) => value.parent === top.id).map((child) => ({ ...child, children: [] })) }));
}

// Every folder id the tree shows. A character whose folder is not among them sits in no folder.
export const shownFolders = (tree: FolderTree[]) => new Set(tree.flatMap((top) => [top.id, ...top.children.map((child) => child.id)]));

// A folder holds the characters in it and in its subfolders.
export const holds = (folder: FolderTree, character: Character) => character.folder === folder.id || folder.children.some((child) => child.id === character.folder);

// The picture of a new character: the original goes to its sealed blob, the thumbnail into the avatar
// object beside it.
export type Picture = { bytes: Uint8Array<ArrayBuffer>; type: string; thumb: string };
export type Progress = (step: { kind: 'picture' } | { kind: 'lore'; saved: number; total: number }) => void;

// Lorebook entries are saved this many at a time: one request each, and bots carry hundreds.
const PARALLEL = 8;

// The character is saved last, so it shows up only once its picture and lorebook are in. A failure
// midway leaves pieces nothing points at, never a character missing some of its own.
export async function addCharacter(store: ObjectStore, vault: OpenVault, character: Character, lore: Lore[], picture: Picture | null, progress: Progress): Promise<ApiResult<string>> {
  const id = crypto.randomUUID();
  if (picture) {
    progress({ kind: 'picture' });
    const blob = crypto.randomUUID();
    const put = await putBlob(vault, blob, picture.bytes);
    if (!put.ok) return put;
    const saved = await store.save<Avatar>('avatar', blob, () => ({ type: picture.type, size: picture.bytes.length, thumb: picture.thumb }), id);
    if (!saved.ok) return saved;
  }
  for (let start = 0; start < lore.length; start += PARALLEL) {
    progress({ kind: 'lore', saved: start, total: lore.length });
    const saved = await Promise.all(lore.slice(start, start + PARALLEL).map((entry) => store.save<Lore>('lore', crypto.randomUUID(), () => entry, id)));
    const failure = saved.find((result) => !result.ok);
    if (failure && !failure.ok) return failure;
  }
  const saved = await store.save<Character>('character', id, () => character);
  return saved.ok ? { ok: true, data: id } : saved;
}

// A copy that goes its own way (사본 만들기): the card under a new name, the lorebook and the picture,
// in the original's folder. Chats stay with the original. The picture is copied, not shared, because a
// blob is sealed to its own id.
export async function copyCharacter(store: ObjectStore, vault: OpenVault, id: string, name: string, progress: Progress): Promise<ApiResult<string>> {
  const original = store.get<Character>(id)!.value;
  const avatar = store.list<Avatar>('avatar').find((candidate) => candidate.parent === id);
  let picture: Picture | null = null;
  if (avatar) {
    const bytes = await getBlob(vault, avatar.id);
    if (!bytes.ok) return bytes;
    picture = { bytes: bytes.data, type: avatar.value.type, thumb: avatar.value.thumb };
  }
  const lore = store
    .list<Lore>('lore')
    .filter((entry) => entry.parent === id)
    .map((entry) => entry.value);
  return addCharacter(store, vault, { ...original, card: { ...original.card, name }, origin: { id, name: original.card.name } }, lore, picture, progress);
}
