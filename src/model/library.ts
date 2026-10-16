export type PackOwner = { kind: 'character' | 'module'; id: string };
// A lorebook's owner: a pack's, or a chat's own (채팅 로어북), which owns no scripts, so PackOwner leaves it out.
export type LoreOwner = { kind: PackOwner['kind'] | 'chat'; id: string };
import type { FileRef } from '../vault/files';
import type { Card, LoreEntry, Pack } from '../engine/import/types';
import type { Translation, TranslateSwitches } from './chat';
import type { FeatureSwitches } from './features';
import type { IllustrateSwitches } from './illustration';
import type { Stored } from './kinds';
import type { ToggleValues } from './prompt';

// loreFolders only group its lorebook on screen.
// origin is the character it was copied from, named as it was then, so a gone origin can still be named.
// alias: 별명, the user's own note to tell apart characters (or personas) of one name. It is never sent, unlike the
// card's nickname (부르는 이름), which CCv3 puts in {{char}}'s place.
export type Character = Mark & {
  card: Card;
  alias?: string;
  folder: string | null;
  loreFolders: LoreFolder[];
  origin?: { id: string; name: string };
  toggles?: ToggleValues;
  // 고정 페르소나: the persona its chats use in place of the default, unless a chat picks its own.
  persona?: string;
  // 이 캐릭터만 따로: its chats' translation switches in place of the shared Settings.translate.
  ownTranslate?: TranslateSwitches;
  // 번역가의 노트: added to the 전역 one (Settings.translatorNote), never replacing it as the switches do.
  translatorNote?: string;
  // 이 캐릭터만 따로: its chats' 삽화 switches in place of the shared Settings.illustrate.
  ownIllustrate?: IllustrateSwitches;
  // 봇 스타일: false shows the chats' messages without the bot's HTML and CSS. Absent is on.
  decor?: boolean;
  // Whether the bot's Lua may call models, which costs the user. Absent: not asked yet, and the first call asks.
  botModels?: boolean;
  // Whether the scripts of its chats, its modules' included, may rewrite its card (setBackgroundEmbedding). Asked once
  // per character, not per script. Absent: not asked yet, and the first write asks.
  cardWrites?: boolean;
  // Absent fields are the defaults.
  pictures?: Pictures;
  // 상태창 지정: the display scripts, by id in card.regex, whose boxes are the character's status window, shown once
  // for the latest message instead of in every one. An id that names no script marks nothing, so a deleted script's
  // 되돌리기 brings its mark back.
  statusScripts?: string[];
  // 추론을 본문에 표시: its replies keep the thinking blocks they write inside the text (connectors/thoughts) where they
  // are, for a bot that draws them itself. Absent: they move to the reply's reasoning.
  keepThoughts?: true;
  // Translations of the card's readable texts (readableTexts), keyed by the text as the card holds it and the
  // language, so an edited text or a changed language translates anew. A chat not begun shows its greetings' here.
  translations?: TextTranslation[];
  // The Risu chaId of a character brought from Risu: a move skips it, and 이미지만 가져오기 finds it.
  risu?: string;
  // The modules on in its chats, in the order they were turned on (design §6.5). One that is gone reads as off.
  modules?: string[];
  // 기능 in its chats, over its chats' prompt's (runtime/features).
  features?: FeatureSwitches;
};

// Its lorebook and assets are its children, as a character's are.
// namespace: Risu's, which {{moduleenabled::…}} asks by. loreFolders only group its lorebook on screen.
// risu: the id module files name it by (engine/import/types ImportedModule.risu), set for one brought from a Risu backup,
// which a move skips, or with a character's charx, which a later charx bundling it is attached to. takesMemory: whether its tool may hold the
// memory slot of the chats it is on in, which turns the built-in memory off there; absent: not asked yet.
export type Module = Pack & Mark & {
  botModels?: boolean;
  takesMemory?: boolean;
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
export type TextTranslation = { source: string; language: string; translation: Translation };
export type LoreFolder = { id: string; name: string };

const DAY = 24 * 60 * 60 * 1000;

// What goes to 휴지통 when deleted: it waits KEEP_DELETED, then goes for good with everything it owns (runtime/characters
// purgeExpired). deleted is when it went there; purging: that removal has begun, so it can no longer be brought back.
// A character's chats go with it; a deleted chat stays whole for 되돌리기 until that purge. A deleted module is off
// everywhere and absent from live lists. The next purge finishes a removal interrupted after purging was marked.
export const REMOVABLE = ['character', 'module', 'chat', 'prompt', 'persona', 'profile'] as const;
export type Removable = (typeof REMOVABLE)[number];
export type Mark = { deleted?: number; purging?: true };

// Whether it is out of 휴지통, and whether 휴지통 shows it: one being removed for good (purging) is neither.
export const isLive = ({ deleted }: Mark) => deleted === undefined;
export const isBinned = ({ deleted, purging }: Mark) => deleted !== undefined && !purging;

// A stored object as every reader but its removal and its undo sees it: null while it is in 휴지통.
export const live = <T extends { value: Mark }>(stored: T | null): T | null => (stored && isLive(stored.value) ? stored : null);

export const binned = <T extends { value: Mark }>(items: T[]): T[] => items.filter(({ value }) => isBinned(value)).sort((a, b) => b.value.deleted! - a.value.deleted!);

// One of a deleted character is not listed: it goes or comes back with its character.
export const binsChat = (chat: { character: string | null } & Mark, characterLive: (id: string) => boolean) =>
  isBinned(chat) && (chat.character === null || characterLive(chat.character));

export const KEEP_DELETED = 7 * DAY;
export const KEEP_DAYS = KEEP_DELETED / DAY;

export const textTranslation = ({ translations }: Character, source: string, language: string) =>
  translations?.find((each) => each.source === source && each.language === language)?.translation;

// What the user reads to know the character, which 번역 on the character screen translates; empty ones left out.
export const readableTexts = (card: Card) =>
  [card.creatorNotes, card.description, card.personality, card.scenario, card.exampleDialogue, ...card.greetings].filter((text) => text.trim());

// At 0 or less it is due, and purgeExpired removes it.
export const daysLeft = ({ deleted }: Mark, now: number) => Math.ceil((deleted! + KEEP_DELETED - now) / DAY);

// What a search over characters reads: the card's name and nickname and the alias the user gave it.
export const characterTexts = ({ card, alias }: Character) => [card.name, card.nickname ?? '', alias ?? ''];

export type Lore = Omit<LoreEntry, 'folder'> & { folder: string | null };

// Up to FOLDER_DEPTH levels deep: a subfolder's parent is the folder it sits in, and top folders have
// none. It lives in the sealed body, not the object's parent, so the server never sees the tree.
export type Folder = { name: string; parent?: string };
export const FOLDER_DEPTH = 3;
export type FolderTree = Stored<'folder'> & { children: FolderTree[] };

// thumb: a small copy that syncs with the objects, so lists need no file fetch.
export type Avatar = { type: string; size: number; thumb: string; file: FileRef };

// Kind `asset`, whose parent is the character or module (design §6.4). type is what the bytes are, read from them.
export type Asset = { name: string; type: string; size: number; file: FileRef };

// A character with its chats, or (id null) the chats that have no character: 캐릭터 없이. face: the avatar's thumbnail;
// avatar: its id, whose file is the picture at full size.
export type Shelf<C> = { id: string | null; character: Character | null; face: string | null; avatar: string | null; chats: C[] };
export type CharacterShelf<C> = Shelf<C> & { id: string; character: Character };

type ChatLike = { chat: { character: string | null } & Mark; order: number };

// chats come newest first. A character is as recent as its latest chat; those with none come last, by name (user
// ruling, 2026-10-08), not by their own rev, which every edit and upgrade rewrite moves. Deleted characters and their
// chats are kept apart, most recently deleted first. binned are the deleted chats: deletedChats lists those binsChat
// lists, most recently deleted first. One being removed for good (purging) is listed nowhere: it can no longer be
// brought back.
export function shelve<C extends ChatLike>(
  characters: Stored<'character'>[],
  avatars: Stored<'avatar'>[],
  chats: C[],
  binned: C[],
): { characters: CharacterShelf<C>[]; none: Shelf<C>; deleted: CharacterShelf<C>[]; deletedChats: C[] } {
  const avatarOf = new Map(avatars.map((avatar) => [avatar.parent, avatar]));
  const grouped = new Map<string | null, C[]>();
  for (const item of chats) {
    const own = grouped.get(item.chat.character);
    if (own) own.push(item);
    else grouped.set(item.chat.character, [item]);
  }
  const shelves = characters.map(({ id, value }) => ({ id, character: value, face: avatarOf.get(id)?.value.thumb ?? null, avatar: avatarOf.get(id)?.id ?? null, chats: grouped.get(id) ?? [] }));
  const loose = grouped.get(null) ?? [];
  const live = shelves.filter((shelf) => isLive(shelf.character));
  const liveIds = new Set(live.map((shelf) => shelf.id));
  return {
    characters: live.sort((a, b) => (b.chats[0]?.order ?? 0) - (a.chats[0]?.order ?? 0) || a.character.card.name.localeCompare(b.character.card.name, 'ko')),
    none: { id: null, character: null, face: null, avatar: null, chats: loose },
    deleted: shelves.filter((shelf) => isBinned(shelf.character)).sort((a, b) => b.character.deleted! - a.character.deleted!),
    deletedChats: binned
      .filter(({ chat }) => binsChat(chat, (id) => liveIds.has(id)))
      .sort((a, b) => b.chat.deleted! - a.chat.deleted!),
  };
}

// A subfolder whose parent is gone (removed on another device meanwhile) stands at the top instead of vanishing.
export function nest(folders: Stored<'folder'>[]): FolderTree[] {
  const sorted = [...folders].sort((a, b) => a.value.name.localeCompare(b.value.name, 'ko'));
  const ids = new Set(sorted.map((folder) => folder.id));
  const children = new Map<string, Stored<'folder'>[]>();
  for (const folder of sorted) {
    const parent = folder.value.parent;
    if (parent === undefined) continue;
    const group = children.get(parent);
    if (group) group.push(folder);
    else children.set(parent, [folder]);
  }
  const grow = (folder: Stored<'folder'>): FolderTree => ({ ...folder, children: (children.get(folder.id) ?? []).map(grow) });
  return sorted.filter(({ value }) => value.parent === undefined || !ids.has(value.parent)).map(grow);
}

export const withInside = (folder: FolderTree): FolderTree[] => [folder, ...folder.children.flatMap(withInside)];
export const holds = (folder: FolderTree, character: Character) => character.folder !== null && withInside(folder).some(({ id }) => id === character.folder);

// What a folder holds (holds): direct are the characters in the folder itself, characters those in its subfolders too.
// up: the folder it sits in.
export type FolderContents<C> = { folder: FolderTree; up: FolderTree | null; direct: CharacterShelf<C>[]; characters: CharacterShelf<C>[] };

// The folders from the top down to id, itself last.
export function pathOf<C>(byFolder: ReadonlyMap<string, FolderContents<C>>, id: string): FolderTree[] {
  const path: FolderTree[] = [];
  for (let at = byFolder.get(id); at; at = at.up ? byFolder.get(at.up.id) : undefined) path.unshift(at.folder);
  return path;
}

export const pathName = (path: FolderTree[]) => path.map(({ value }) => value.name).join(' › ');

// A character whose folder the tree does not show (removed on another device meanwhile) sits in no folder.
export function indexFolders<C>(characters: CharacterShelf<C>[], folders: FolderTree[]): { byFolder: Map<string, FolderContents<C>>; loose: CharacterShelf<C>[] } {
  const byFolder = new Map<string, FolderContents<C>>();
  const holders = new Map<string, FolderContents<C>[]>();
  const file = (folder: FolderTree, up: FolderTree | null) => {
    const contents: FolderContents<C> = { folder, up, direct: [], characters: [] };
    byFolder.set(folder.id, contents);
    for (const { id } of withInside(folder)) {
      const group = holders.get(id);
      if (group) group.push(contents);
      else holders.set(id, [contents]);
    }
    for (const child of folder.children) file(child, folder);
  };
  for (const top of folders) file(top, null);
  const loose: CharacterShelf<C>[] = [];
  // Walk the library order once so a folder's direct and nested characters stay interleaved by recency.
  for (const shelf of characters) {
    const own = shelf.character.folder === null ? undefined : byFolder.get(shelf.character.folder);
    if (!own) {
      loose.push(shelf);
      continue;
    }
    own.direct.push(shelf);
    for (const holder of holders.get(own.folder.id)!) holder.characters.push(shelf);
  }
  return { byFolder, loose };
}
