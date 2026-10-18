import type { Toggle, ToggleLine, ToggleMark, UnreadLine } from '../../model/prompt';
import { toggleTree, type GroupHead, type LineAt, type ToggleEntry } from '../../model/toggles';

export type NoteLine = Extract<ToggleMark, { kind: 'divider' | 'caption' }>;
export type LaidLine<T> = { row: T } | { note: LineAt<NoteLine> };
export type Laid<T> = LaidLine<T> | { group: LineAt<GroupHead>; items: LaidLine<T>[] };

// The list as its groups hold it (model/toggles toggleTree). rowOf makes the row of a toggle or an unread line, or
// null to leave it out.
export function laidOut<T>(lines: readonly ToggleLine[], rowOf: (line: Toggle | UnreadLine, at: number) => T | null): Laid<T>[] {
  const lay = ({ line, at }: LineAt<ToggleEntry>): LaidLine<T>[] => {
    if (line.kind === 'divider' || line.kind === 'caption') return [{ note: { line, at } }];
    const row = rowOf(line, at);
    return row === null ? [] : [{ row }];
  };
  return toggleTree(lines).flatMap<Laid<T>>((node) => ('head' in node ? [{ group: node.head, items: node.members.flatMap(lay) }] : lay(node)));
}
