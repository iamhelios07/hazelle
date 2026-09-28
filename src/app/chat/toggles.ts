import type { Toggle } from '../../model/prompt';
import type { ChatToggleSet } from '../../runtime/turn';

export type ToggleRow = { toggle: Toggle; value: string; changed: boolean };
export type ToggleRows = { prompt: ToggleRow[]; card: ToggleRow[]; changed: number };

// The chat's toggles as the panel lists them: the first fromPrompt are the prompt's (runtime/turn togglesOf puts
// them first), each with its value and whether that differs from its default.
export function toggleRows({ declared, value }: ChatToggleSet, fromPrompt: number): ToggleRows {
  const rows = declared.map((toggle) => {
    const current = value(toggle.key)!;
    return { toggle, value: current, changed: current !== toggle.default };
  });
  return { prompt: rows.slice(0, fromPrompt), card: rows.slice(fromPrompt), changed: rows.filter((row) => row.changed).length };
}

// What the panel shows of a group: the rows the search and the 바꾼 것 filter keep, those that differed when the
// panel opened or the filter changed first, so a row does not jump away under the pointer as it changes.
export function shownRows(rows: readonly ToggleRow[], query: string, onlyChanged: boolean, first: ReadonlySet<string>): ToggleRow[] {
  const words = query.trim().toLowerCase();
  const kept = rows.filter((row) => (!words || row.toggle.label.toLowerCase().includes(words)) && (!onlyChanged || row.changed));
  return [...kept.filter((row) => first.has(row.toggle.key)), ...kept.filter((row) => !first.has(row.toggle.key))];
}
