import type { Toggle, ToggleMark, UnreadLine } from '../../model/prompt';
import type { GroupHead, LineAt, ToggleEntry, ToggleNode } from '../../model/toggles';

export type NoteLine = Extract<ToggleMark, { kind: 'divider' | 'caption' }>;
export type LaidLine<T> = { row: T } | { note: LineAt<NoteLine> };
export type Laid<T> = LaidLine<T> | { group: LineAt<GroupHead>; items: LaidLine<T>[] };

// The list as its groups hold it (model/toggles toggleTree).
export function laidOut<T>(nodes: readonly ToggleNode[], rowOf: (line: Toggle | UnreadLine, at: number) => T | null): Laid<T>[] {
  const lay = ({ line, at }: LineAt<ToggleEntry>): LaidLine<T>[] => {
    if (line.kind === 'divider' || line.kind === 'caption') return [{ note: { line, at } }];
    const row = rowOf(line, at);
    return row === null ? [] : [{ row }];
  };
  return nodes.flatMap<Laid<T>>((node) => ('head' in node ? [{ group: node.head, items: node.members.flatMap(lay) }] : lay(node)));
}
