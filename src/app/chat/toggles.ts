import { readToggles } from '../../engine/import/toggles';
import type { Character } from '../../model/library';
import type { Toggle, ToggleValues } from '../../model/prompt';
import { chatToggles, toggleValue } from '../../model/toggles';

export type ToggleRow = { toggle: Toggle; value: string; changed: boolean };
export type ToggleRows = { prompt: ToggleRow[]; card: ToggleRow[]; changed: number };

// The chat's toggles as the panel lists them: the prompt's, then the card's that the prompt does not declare, in
// chatToggles' order, each with its value (the character's, or 캐릭터 없이's) and whether that differs from its
// default. The same declarations and values runtime/turn scopeOf sends with.
export function toggleRows(prompt: readonly Toggle[], character: Character | null, none: ToggleValues | undefined): ToggleRows {
  const declared = chatToggles(prompt, character ? readToggles(character.card.toggles).toggles : []);
  const value = toggleValue(declared, (character ? character.toggles : none) ?? {});
  const rows = declared.map((toggle) => {
    const current = value(toggle.key)!;
    return { toggle, value: current, changed: current !== toggle.default };
  });
  return { prompt: rows.slice(0, prompt.length), card: rows.slice(prompt.length), changed: rows.filter((row) => row.changed).length };
}

// What the panel shows of a group: the rows the search and the 바꾼 것 filter keep, those that differed when the
// panel opened or the filter changed first, so a row does not jump away under the pointer as it changes.
export function shownRows(rows: readonly ToggleRow[], query: string, onlyChanged: boolean, first: ReadonlySet<string>): ToggleRow[] {
  const words = query.trim().toLowerCase();
  const kept = rows.filter((row) => (!words || row.toggle.label.toLowerCase().includes(words)) && (!onlyChanged || row.changed));
  return [...kept.filter((row) => first.has(row.toggle.key)), ...kept.filter((row) => !first.has(row.toggle.key))];
}
