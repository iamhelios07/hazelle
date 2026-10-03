import type { FileRef } from '../vault/files';
import type { Card, LoreEntry, Pack } from '../engine/import/types';
import type { Translation, TranslateSwitches } from './chat';
import type { Stored } from './kinds';
import type { ToggleValues } from './prompt';

// folder is the library folder it sits in; loreFolders only group its lorebook on screen.
// origin is the character it was copied from, named as it was then, so a gone origin can still be named.
// toggles holds the values set for it, over the declared defaults; translate, its chats' 번역.
// alias: 별명, the user's own note to tell apart characters (or personas) of one name. It is never sent, unlike the
// card's nickname (부르는 이름), which CCv3 puts in {{char}}'s place.
export type Character = Mark & {
  card: Card;
  alias?: string;
  folder: string | null;
  loreFolders: LoreFolder[];
  origin?: { id: string; name: string };
  toggles?: ToggleValues;
  translate?: TranslateSwitches;
  // 봇 꾸밈: false shows the chats' messages without the bot's HTML and CSS. Absent is on.
  decor?: boolean;
  // Whether the bot's Lua may call models, which costs the user. Absent: not asked yet, and the first call asks.
  botModels?: boolean;
  // How its chats draw a line that is only a picture. Absent fields are the defaults.
  pictures?: Pictures;
  // 상태창 지정: the display scripts, by place in card.regex, whose boxes are the character's status window, shown once
  // for the latest message instead of in every one. Only an import writes card.regex; an editor that reorders it must
  // move these along.
  statusScripts?: number[];
  // 옆에 두기: 상태 rests in the panel beside the story whenever a chat of it opens with room for one, instead of
  // peeking from the story's edge.
  keepStatus?: true;
  // A greeting's translation, made before any chat of it was saved, which every new chat opens with. Keyed by the
  // greeting as the card holds it and the language, so an edited greeting or a changed language translates anew.
  greetingTranslations?: GreetingTranslation[];
  // The Risu chaId of a character brought from Risu: a move skips it, and 그림 채우기 finds it.
  risu?: string;
  // The modules on in its chats, in the order they were turned on (design §6.5). One that is gone reads as off.
  modules?: string[];
};

// Kind `module`: a pack with a name, on in every chat (settings.modules, 항상) or in a character's
// (character.modules). Its lorebook and assets are its children, as a character's are.
// namespace: Risu's, which {{moduleenabled::…}} asks by. loreFolders only group its lorebook on screen.
// risu: the Risu id of one brought from a Risu backup, which a move skips.
export type Module = Pack & Mark & {
  name: string;
  description: string;
  namespace: string | null;
  loreFolders: LoreFolder[];
  risu?: string;
};
// fold false shows such a picture whole instead of its top until opened. peek is the height its top shows at, most the
// height no such picture is drawn taller than (shrunk to fit), each in percent of the screen's height.
export type Pictures = { fold?: false; peek?: number; most?: number };
export const PICTURE_PERCENT = { min: 10, max: 100 };
export type GreetingTranslation = { greeting: string; language: string; translation: Translation };
export type LoreFolder = { id: string; name: string };

const DAY = 24 * 60 * 60 * 1000;

// What goes to 휴지통 when deleted: it waits KEEP_DELETED, then goes for good with everything it owns (runtime/characters
// purgeExpired). deleted is when it went there; purging: that removal has begun, so it can no longer be brought back.
// A character's chats go with it; a deleted chat stays whole for undo until that purge. A deleted module is off
// everywhere and absent from live lists. The next purge finishes a removal interrupted after purging was marked.
export const REMOVABLE = ['character', 'module', 'chat', 'prompt', 'persona', 'profile'] as const;
export type Removable = (typeof REMOVABLE)[number];
export type Mark = { deleted?: number; purging?: true };

// A stored object as every reader but its removal and its undo sees it: null while it is in 휴지통.
export const live = <T extends { value: Mark }>(stored: T | null): T | null => (stored && stored.value.deleted === undefined ? stored : null);

// Those in 휴지통, most recently deleted first.
export const binned = <T extends { value: Mark }>(items: T[]): T[] => items.filter(({ value }) => value.deleted !== undefined && !value.purging).sort((a, b) => b.value.deleted! - a.value.deleted!);

// How long what is in 휴지통 waits before it is removed for good.
export const KEEP_DELETED = 7 * DAY;
// KEEP_DELETED as the copy names it (7일).
export const KEEP_DAYS = KEEP_DELETED / DAY;

export const greetingTranslation = ({ greetingTranslations }: Character, greeting: string, language: string) =>
  greetingTranslations?.find((each) => each.greeting === greeting && each.language === language)?.translation;

// Whole days something in 휴지통 has left. At 0 or less it is due, and purgeExpired removes it.
export const daysLeft = ({ deleted }: Mark, now: number) => Math.ceil((deleted! + KEEP_DELETED - now) / DAY);

// The name search of the gallery and the sidebar: the query, trimmed and in any case, within the name, nickname or alias.
export const matches = ({ card, alias }: Character, query: string) =>
  `${card.name} ${card.nickname ?? ''} ${alias ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());

// Kind `lore`, whose parent is the character or module it belongs to. folder is the id of one of its loreFolders.
export type Lore = Omit<LoreEntry, 'folder'> & { folder: string | null };

// Two levels deep: a subfolder's parent is the top folder it sits in, and top folders have
// none. It lives in the sealed body, not the object's parent, so the server never sees the tree.
export type Folder = { name: string; parent?: string };
export type FolderTree = Stored<'folder'> & { children: FolderTree[] };

// Kind `avatar`, whose parent is the character: file is the original picture, and thumb a small copy that syncs with
// the objects, so lists need no file fetch.
export type Avatar = { type: string; size: number; thumb: string; file: FileRef };

// Kind `asset`, whose parent is the character or module: a picture of the bot's own, which its text reaches by name
// ({{raw::name}}, design §6.4). type is what the bytes are, read from them.
export type Asset = { name: string; type: string; size: number; file: FileRef };

// A character with its chats, or (id null) the chats that have no character: 캐릭터 없이.
export type Shelf<C> = { id: string | null; character: Character | null; face: string | null; chats: C[]; order: number };
export type CharacterShelf<C> = Shelf<C> & { id: string; character: Character };

type ChatLike = { chat: { character: string | null } & Mark; order: number };

// chats come newest first. A character is as recent as its latest chat, or, with none yet, as its own
// last change. Deleted characters and their chats are kept apart, most recently deleted first. binned are the deleted
// chats: deletedChats lists those of a character not deleted, or of none, most recently deleted first. A deleted chat
// of a deleted character is not listed: it goes or comes back with its character. One being removed for good
// (purging) is listed nowhere: it can no longer be brought back.
export function shelve<C extends ChatLike>(
  characters: Stored<'character'>[],
  avatars: Stored<'avatar'>[],
  chats: C[],
  binned: C[],
): { characters: CharacterShelf<C>[]; none: Shelf<C>; deleted: CharacterShelf<C>[]; deletedChats: C[] } {
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
  const live = shelves.filter((shelf) => shelf.character.deleted === undefined);
  const liveIds = new Set(live.map((shelf) => shelf.id));
  return {
    characters: live.sort((a, b) => b.order - a.order),
    none: { id: null, character: null, face: null, chats: loose, order: loose[0]?.order ?? 0 },
    deleted: shelves.filter((shelf) => shelf.character.deleted !== undefined && !shelf.character.purging).sort((a, b) => b.character.deleted! - a.character.deleted!),
    deletedChats: binned
      .filter(({ chat }) => !chat.purging && (chat.character === null || liveIds.has(chat.character)))
      .sort((a, b) => b.chat.deleted! - a.chat.deleted!),
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
