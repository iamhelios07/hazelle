import type { RisuBackup } from '../../engine/import/types';
import type { MovePick } from '../../runtime/move';

export type Ticks = { characters: boolean[]; personas: boolean[]; presets: boolean[] };

// What can be ticked, which is also what starts ticked: a character already brought from Risu (have holds its Risu id)
// and a preset the importer refused cannot.
export function tickable(backup: RisuBackup, have: Set<string>): Ticks {
  return {
    characters: backup.characters.map((character) => !have.has(character.id)),
    personas: backup.personas.map(() => true),
    presets: backup.presets.map((preset) => preset.result.ok),
  };
}

export function toPick(backup: RisuBackup, ticks: Ticks): MovePick {
  return {
    characters: backup.characters.filter((_, index) => ticks.characters[index]),
    personas: backup.personas.filter((_, index) => ticks.personas[index]),
    presets: backup.presets.filter((_, index) => ticks.presets[index]),
  };
}

export const tickCount = (ticks: Ticks): number => [...ticks.characters, ...ticks.personas, ...ticks.presets].filter(Boolean).length;
