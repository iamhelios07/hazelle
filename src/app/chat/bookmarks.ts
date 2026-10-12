import type { Bookmark, Message } from '../../model/chat';

// to: the versions to show, from the top down, that put the message on the line shown; none for one on it now.
export type BookmarkRow = { message: Message; name: string | null; to: { message: Message; index: number }[] };

// In story order. A bookmark whose message is deleted, or continues a version of a deleted message other than the one
// it shows, is in no tree (model/chat ChatFold.tree) and left out.
export function bookmarkRows(bookmarks: readonly Bookmark[], tree: readonly { message: Message; follows: string | null }[]): BookmarkRow[] {
  const names = new Map(bookmarks.map(({ message, name }) => [message, name ?? null]));
  const owners = new Map(tree.flatMap((node) => node.message.versions.map(({ id }, index) => [id, { node, index }] as const)));
  return tree.flatMap(({ message, follows }) => {
    if (!names.has(message.id)) return [];
    const to: BookmarkRow['to'] = [];
    for (let above = follows; above !== null; ) {
      const { node, index } = owners.get(above)!;
      if (node.message.selected !== index) to.unshift({ message: node.message, index });
      above = node.follows;
    }
    return [{ message, name: names.get(message.id)!, to }];
  });
}
