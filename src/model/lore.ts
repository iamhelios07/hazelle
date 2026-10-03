import type { Stored } from './kinds';
import type { LoreFolder } from './library';

export type LoreGroup = { folder: LoreFolder | null; entries: Stored<'lore'>[] };

// A lorebook as its editor lists it: the entries in no folder first, then each folder in the owner's order, each group
// in the order the entries go into the prompt. An entry naming a folder the owner no longer has (another device
// removed it meanwhile) is in no folder.
export function loreGroups(entries: Stored<'lore'>[], folders: LoreFolder[]): LoreGroup[] {
  const known = new Set(folders.map(({ id }) => id));
  const sorted = entries.toSorted((a, b) => a.value.insertionOrder - b.value.insertionOrder || a.value.name.localeCompare(b.value.name, 'ko'));
  return [
    { folder: null, entries: sorted.filter(({ value }) => value.folder === null || !known.has(value.folder)) },
    ...folders.map((folder) => ({ folder, entries: sorted.filter(({ value }) => value.folder === folder.id) })),
  ];
}
