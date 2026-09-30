import type { FileRef } from '../vault/files';
import type { Card, LoreEntry } from '../engine/import/types';
import type { TranslateSwitches } from './chat';
import type { Stored } from './kinds';
import type { ToggleValues } from './prompt';

// folder is the library folder it sits in; loreFolders only group its lorebook on screen.
// origin is the character it was copied from, named as it was then, so a gone origin can still be named.
// deleted is when it went to 지운 캐릭터; it and its chats are removed for good KEEP_DELETED later.
// toggles holds the values set for it, over the declared defaults; translate, its chats' 번역.
// alias: 별명, the user's own note to tell apart characters (or personas) of one name. It is never sent, unlike the
// card's nickname (부르는 이름), which CCv3 puts in {{char}}'s place.
export type Character = {
  card: Card;
  alias?: string;
  folder: string | null;
  loreFolders: LoreFolder[];
  origin?: { id: string; name: string };
  deleted?: number;
  toggles?: ToggleValues;
  translate?: TranslateSwitches;
  // 봇 꾸밈: false shows the chats' messages without the bot's HTML and CSS. Absent is on.
  decor?: boolean;
  // 옆에 고정: the display scripts, by place in card.regex, whose boxes show in 상태 beside the story instead of in the
  // messages. Only an import writes card.regex; an editor that reorders it must move these along.
  beside?: number[];
  // 옆에 두기: 상태 rests in the panel beside the story whenever a chat of it opens with room for one, instead of
  // peeking from the story's edge.
  keepStatus?: true;
};
export type LoreFolder = { id: string; name: string };

const DAY = 24 * 60 * 60 * 1000;

// How long a deleted character waits in 지운 캐릭터 before it is removed for good.
export const KEEP_DELETED = 7 * DAY;
// KEEP_DELETED as the copy names it (7일).
export const KEEP_DAYS = KEEP_DELETED / DAY;

// Whole days a character in 지운 캐릭터 has left. At 0 or less it is due, and purgeExpired removes it.
export const daysLeft = (character: Character, now: number) => Math.ceil((character.deleted! + KEEP_DELETED - now) / DAY);

// The name search of the gallery and the sidebar: the query, trimmed and in any case, within the name, nickname or alias.
export const matches = ({ card, alias }: Character, query: string) =>
  `${card.name} ${card.nickname ?? ''} ${alias ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());

// Kind `lore`, whose parent is the character. folder is the id of one of its loreFolders.
export type Lore = Omit<LoreEntry, 'folder'> & { folder: string | null };

// Two levels deep: a subfolder's parent is the top folder it sits in, and top folders have
// none. It lives in the sealed body, not the object's parent, so the server never sees the tree.
export type Folder = { name: string; parent?: string };
export type FolderTree = Stored<'folder'> & { children: FolderTree[] };

// Kind `avatar`, whose parent is the character: file is the original picture, and thumb a small copy that syncs with
// the objects, so lists need no file fetch.
export type Avatar = { type: string; size: number; thumb: string; file: FileRef };

// Kind `asset`, whose parent is the character: a picture of the bot's own, which its text reaches by name
// ({{raw::name}}, design §6.4). type is what the bytes are, read from them.
export type Asset = { name: string; type: string; size: number; file: FileRef };

// A character with its chats, or (id null) the chats that have no character: 캐릭터 없이.
export type Shelf<C> = { id: string | null; character: Character | null; face: string | null; chats: C[]; order: number };
export type CharacterShelf<C> = Shelf<C> & { id: string; character: Character };

type ChatLike = { chat: { character: string | null }; order: number };

// chats come newest first. A character is as recent as its latest chat, or, with none yet, as its own
// last change. Deleted characters and their chats are kept apart, most recently deleted first.
export function shelve<C extends ChatLike>(
  characters: Stored<'character'>[],
  avatars: Stored<'avatar'>[],
  chats: C[],
): { characters: CharacterShelf<C>[]; none: Shelf<C>; deleted: CharacterShelf<C>[] } {
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
    characters: shelves.filter((shelf) => shelf.character.deleted === undefined).sort((a, b) => b.order - a.order),
    none: { id: null, character: null, face: null, chats: loose, order: loose[0]?.order ?? 0 },
    deleted: shelves.filter((shelf) => shelf.character.deleted !== undefined).sort((a, b) => b.character.deleted! - a.character.deleted!),
  };
}

// Top folders with their subfolders, both by name. A subfolder whose top folder is gone (removed on
// another device meanwhile) stands at the top instead of vanishing.
export function nest(folders: Stored<'folder'>[]): FolderTree[] {
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
