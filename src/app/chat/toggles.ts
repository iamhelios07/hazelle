import { readToggles } from '../../engine/import/toggles';
import type { Toggle } from '../../model/prompt';
import type { ChatToggleSet } from '../../runtime/turn';

export type ToggleRow = { toggle: Toggle; value: string; changed: boolean };
export type ToggleRows = { prompt: ToggleRow[]; card: ToggleRow[]; changed: number };

// The first fromPrompt are the prompt's (runtime/turn togglesOf puts them first).
export function toggleRows({ declared, value }: ChatToggleSet, fromPrompt: number): ToggleRows {
  const rows = declared.map((toggle) => {
    const current = value(toggle.key)!;
    return { toggle, value: current, changed: current !== toggle.default };
  });
  return { prompt: rows.slice(0, fromPrompt), card: rows.slice(fromPrompt), changed: rows.filter((row) => row.changed).length };
}

// A key both declare is the card's, whose pack comes first (runtime/turn packsOf).
export function splitByCard(rows: readonly ToggleRow[], card: string): { card: ToggleRow[]; modules: ToggleRow[] } {
  const own = new Set(readToggles(card).toggles.map(({ key }) => key));
  return { card: rows.filter(({ toggle }) => own.has(toggle.key)), modules: rows.filter(({ toggle }) => !own.has(toggle.key)) };
}

// What the panel shows of a group: the rows the search and the 변경 filter keep, those that differed when the
// panel opened or the filter changed first, so a row does not jump away under the pointer as it changes.
export function shownRows(rows: readonly ToggleRow[], query: string, onlyChanged: boolean, first: ReadonlySet<string>): ToggleRow[] {
  const words = query.trim().toLowerCase();
  const kept = rows.filter((row) => (!words || row.toggle.label.toLowerCase().includes(words)) && (!onlyChanged || row.changed));
  return [...kept.filter((row) => first.has(row.toggle.key)), ...kept.filter((row) => !first.has(row.toggle.key))];
}
