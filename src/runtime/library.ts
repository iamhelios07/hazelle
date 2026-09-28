import type { Card, LoreEntry } from '../engine/import/types';
import type { Stored } from './store';

// folder is the library folder it sits in (design F6); loreFolders only group its lorebook on screen.
export type Character = { card: Card; folder: string | null; loreFolders: LoreFolder[] };
export type LoreFolder = { id: string; name: string };

// Kind `lore`, whose parent is the character. folder is the id of one of its loreFolders.
export type Lore = Omit<LoreEntry, 'folder'> & { folder: string | null };

// One level deep (design F6).
export type Folder = { name: string };

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
