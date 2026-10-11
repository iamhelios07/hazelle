import { isToggle, type Toggle, type ToggleMark } from '../../model/prompt';
import type { ChatToggleSet, ToggleSource } from '../../runtime/chat-context';

export type ToggleRow = { toggle: Toggle; value: string; changed: boolean };

// A text toggle's typed value waits under this key (common/useAutosave) before it is stored.
export const toggleSaveKey = (owner: string | null, key: string) => `toggle:${owner ?? ''}:${key}`;
export type ToggleNote = Extract<ToggleMark, { kind: 'divider' | 'caption' }>;
export type ToggleItem = ToggleRow | ToggleNote | { kind: 'group'; label: string; items: (ToggleRow | ToggleNote)[] };
export type ToggleSection = Pick<ToggleSource, 'from' | 'name'> & { rows: ToggleRow[]; items: ToggleItem[] };
export type ToggleRows = { sections: ToggleSection[]; changed: number };

// A key declared again by a later source shows once, in the source that declares it (model/toggles chatToggles keeps
// the very line, so it is matched by identity). A source with no toggle of its own is left out.
export function toggleRows({ declared, sources, value }: ChatToggleSet): ToggleRows {
  const rows = new Map(
    declared.map((toggle) => {
      const current = value(toggle.key)!;
      return [toggle, { toggle, value: current, changed: current !== toggle.default }];
    }),
  );
  const sections = sources
    .map(({ from, name, lines }) => {
      const kept = lines.flatMap<ToggleRow | ToggleMark>((line) => (isToggle(line) ? (rows.get(line) ?? []) : [line]));
      return { from, name, rows: kept.filter((line): line is ToggleRow => 'toggle' in line), items: laidOut(kept) };
    })
    .filter((section) => section.rows.length > 0);
  return { sections, changed: [...rows.values()].filter((row) => row.changed).length };
}

// As Risu lays them out: a group holds the lines up to its groupEnd or the next group and is left out when it holds
// nothing, groups do not nest, and a divider right after one of the same label shows once.
function laidOut(lines: readonly (ToggleRow | ToggleMark)[]): ToggleItem[] {
  const items: ToggleItem[] = [];
  let group: Extract<ToggleItem, { kind: 'group' }> | null = null;
  for (const line of lines) {
    if ('toggle' in line || line.kind === 'divider' || line.kind === 'caption') {
      const into = group ? group.items : items;
      const last = into.at(-1);
      const repeated = !('toggle' in line) && line.kind === 'divider' && last && !('toggle' in last) && last.kind === 'divider' && last.label === line.label;
      if (!repeated) into.push(line);
      continue;
    }
    group = line.kind === 'group' ? { kind: 'group', label: line.label, items: [] } : null;
    if (group) items.push(group);
  }
  return items.filter((item) => !('items' in item) || item.items.length > 0);
}

// What the panel shows of a source while searching or filtering: the rows the search and the 변경 filter keep, those
// that differed when the panel opened or the filter changed first, so a row does not jump away under the pointer as
// it changes. Layout lines are left out then, since a group or divider over a few found rows would mislead.
export function shownRows(rows: readonly ToggleRow[], found: ReadonlySet<ToggleRow>, onlyChanged: boolean, first: ReadonlySet<string>): ToggleRow[] {
  const kept = rows.filter((row) => found.has(row) && (!onlyChanged || row.changed));
  return [...kept.filter((row) => first.has(row.toggle.key)), ...kept.filter((row) => !first.has(row.toggle.key))];
}
