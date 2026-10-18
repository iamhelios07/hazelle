import type { Toggle, ToggleLine } from '../../model/prompt';
import type { ChatToggleSet, ToggleSource } from '../../runtime/chat-context';
import { laidOut, type Laid } from '../common/toggleLayout';

export type ToggleRow = { toggle: Toggle; value: string; changed: boolean };

// A text toggle's typed value waits under this key (common/useAutosave) before it is stored.
export const toggleSaveKey = (owner: string | null, key: string) => `toggle:${owner ?? ''}:${key}`;
export type ToggleSection = Pick<ToggleSource, 'from' | 'id' | 'name'> & { rows: ToggleRow[]; items: Laid<ToggleRow>[] };
type ToggleRows = { sections: ToggleSection[]; changed: number };

// A key declared again by a later source shows once, in the source that declares it (model/toggles chatToggles keeps
// the very line, so it is matched by identity). A source with no toggle of its own is left out.
export function toggleRows({ declared, sources, value }: ChatToggleSet): ToggleRows {
  const rows = new Map<ToggleLine, ToggleRow>(
    declared.map((toggle) => {
      const current = value(toggle.key)!;
      return [toggle, { toggle, value: current, changed: current !== toggle.default }];
    }),
  );
  const sections = sources
    .map(({ from, id, name, lines }) => ({
      from,
      id,
      name,
      rows: lines.flatMap((line) => rows.get(line) ?? []),
      items: asRisu(laidOut(lines, (line) => rows.get(line) ?? null)),
    }))
    .filter((section) => section.rows.length > 0);
  return { sections, changed: [...rows.values()].filter((row) => row.changed).length };
}

const repeated = (item: Laid<ToggleRow>, last: Laid<ToggleRow> | undefined) =>
  'note' in item && item.note.line.kind === 'divider' && last !== undefined && 'note' in last && last.note.line.kind === 'divider' && last.note.line.label === item.note.line.label;

// As Risu shows them: a group that holds nothing is left out, and a divider right after one of the same label shows once.
function asRisu(items: readonly Laid<ToggleRow>[]): Laid<ToggleRow>[] {
  return items
    .filter((item, at) => !repeated(item, items[at - 1]))
    .map((item) => ('group' in item ? { ...item, items: item.items.filter((inner, at) => !repeated(inner, item.items[at - 1])) } : item))
    .filter((item) => !('group' in item) || item.items.length > 0);
}

// What the panel shows of a source while searching or filtering: the rows the search and the 변경 filter keep, those
// that differed when the panel opened or the filter changed first, so a row does not jump away under the pointer as
// it changes. Layout lines are left out then, since a group or divider over a few found rows would mislead.
export function shownRows(rows: readonly ToggleRow[], found: ReadonlySet<ToggleRow>, onlyChanged: boolean, first: ReadonlySet<string>): ToggleRow[] {
  const kept = rows.filter((row) => found.has(row) && (!onlyChanged || row.changed));
  return [...kept.filter((row) => first.has(row.toggle.key)), ...kept.filter((row) => !first.has(row.toggle.key))];
}
