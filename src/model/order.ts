import type { FolderTree } from './folders';

// Apart from settings, which every chat's display reads: a move here leaves no chat to redisplay or summarize again.
export const ORDER_ID = '00000000-0000-4000-8000-000000000010';
// Absent only until the first open after it shipped writes it (runtime/characters seedOrder).
export type Order = { ids: string[] };

// 직접 순서 holds character and character-folder ids, first first. One it does not name (new, or
// made on another device before its order arrived) stands before the named ones, by name, so it never moves with chats.
// An id whose thing is gone stays: a character back from 휴지통 returns to the place it held, if it held one.
export function arrange<T>(order: readonly string[], items: readonly T[], idOf: (item: T) => string, nameOf: (item: T) => string): T[] {
  const at = new Map(order.map((id, index) => [id, index]));
  const unnamed = items.filter((item) => !at.has(idOf(item))).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ko'));
  const named = items.filter((item) => at.has(idOf(item))).sort((a, b) => at.get(idOf(a))! - at.get(idOf(b))!);
  return [...unnamed, ...named];
}

export const arrangeFolders = (order: readonly string[], folders: readonly FolderTree[]): FolderTree[] =>
  arrange(order, folders, ({ id }) => id, ({ value }) => value.name).map((folder) => ({ ...folder, children: arrangeFolders(order, folder.children) }));

// sequence: the things of one place in their new order. The places they held in the list hold them again, in that
// order, and the rest of the list stays put; one the list did not name yet takes a place at its front.
export function rearrange(order: readonly string[], sequence: readonly string[]): string[] {
  const named = new Set(order);
  const moving = new Set(sequence);
  let next = 0;
  return [...sequence.filter((id) => !named.has(id)), ...order].map((id) => (moving.has(id) ? sequence[next++]! : id));
}

// Filed into a folder, a thing stands first there.
export function toFront(order: readonly string[], ids: readonly string[]): string[] {
  const moved = new Set(ids);
  return [...ids, ...order.filter((id) => !moved.has(id))];
}

// ids with id moved to stand right before another, or last for null.
export function placeBefore(ids: readonly string[], id: string, before: string | null): string[] {
  const rest = ids.filter((each) => each !== id);
  rest.splice(before === null ? rest.length : rest.indexOf(before), 0, id);
  return rest;
}
