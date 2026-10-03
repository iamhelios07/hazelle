import { describe, expect, it } from 'vitest';
import type { ImportedModule, RisuBackup, RisuCharacter, RisuPreset } from '../../engine/import/types';
import { tickable, toPick } from './movePick';

const character = (id: string) => ({ id }) as RisuCharacter;
const module = (risu: string) => ({ risu }) as ImportedModule;
const preset = (ok: boolean) => ({ name: 'p', result: ok ? { ok, prompt: {}, unsupported: [] } : { ok, failure: { kind: 'no-template' } } }) as RisuPreset;

describe('tickable', () => {
  it('leaves out characters and modules already brought and presets the importer refused, and picks the rest', () => {
    const backup = { pictures: 0, characters: [character('a'), character('b')], personas: [{ id: null, name: 'n', alias: '', description: '', picture: async () => null }], presets: [preset(true), preset(false)], modules: [module('m'), module('n')], alwaysModules: ['m'], unsupported: [] } as RisuBackup;
    const can = tickable(backup, { characters: new Set(['a']), modules: new Set(['m']) });
    expect(can).toEqual({ characters: [false, true], personas: [true], presets: [true, false], modules: [false, true] });
    const pick = toPick(backup, can);
    expect(pick.characters.map((item) => item.id)).toEqual(['b']);
    expect(pick.presets).toEqual([backup.presets[0]]);
    expect(pick.modules).toEqual([backup.modules[1]]);
    expect(pick.alwaysModules).toEqual(['m']);
  });
});
