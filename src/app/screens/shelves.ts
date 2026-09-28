import type { Shelf } from '../../model/library';

const CHAT = /^\/chats\/([0-9a-f-]{36})$/;
const SHELF = /^\/characters\/([0-9a-f-]{36}|none)(?:\/new|\/about|\/edit)?$/;

export const shelfPath = (id: string | null) => `/characters/${id ?? 'none'}`;
export const newChatPath = (id: string | null) => (id ? `/characters/${id}/new` : '/chats/new');
// A character's own page on phones, where its shelf path is the list of its chats.
export const aboutPath = (id: string) => `/characters/${id}/about`;
// A character's own page: beside its chats where the sidebar shows them, on its own path on phones.
export const pagePath = (id: string, wide: boolean) => (wide ? shelfPath(id) : aboutPath(id));
export const editPath = (id: string) => `/characters/${id}/edit`;

// Which shelf a path is in: a character's id, null for 캐릭터 없이, or undefined outside every shelf.
export function shelfAt(path: string, chats: { id: string; chat: { character: string | null } }[]): string | null | undefined {
  if (path === '/chats/new') return null;
  const shelf = SHELF.exec(path)?.[1];
  if (shelf) return shelf === 'none' ? null : shelf;
  const chat = CHAT.exec(path)?.[1];
  return chat === undefined ? undefined : chats.find((item) => item.id === chat)?.chat.character;
}

// Picking a character opens its latest chat where the sidebar lists its chats beside it. On phones,
// and for a character with no chat yet, it opens the character's own page.
export function shelfTarget(shelf: Shelf<{ id: string }>, wide: boolean): string {
  const latest = shelf.chats[0];
  return wide && latest ? `/chats/${latest.id}` : shelfPath(shelf.id);
}
