import { describe, expect, it } from 'vitest';
import type { RisuBackup, RisuCharacter, RisuPreset } from '../../engine/import/types';
import { tickable, toPick } from './movePick';

const character = (id: string) => ({ id }) as RisuCharacter;
const preset = (ok: boolean) => ({ name: 'p', result: ok ? { ok, prompt: {}, unsupported: [] } : { ok, failure: { kind: 'no-template' } } }) as RisuPreset;

describe('tickable', () => {
  it('leaves out characters already brought and presets the importer refused, and picks the rest', () => {
    const backup = { characters: [character('a'), character('b')], personas: [{ id: null, name: 'n', description: '', picture: async () => null }], presets: [preset(true), preset(false)], unsupported: [] } as RisuBackup;
    const can = tickable(backup, new Set(['a']));
    expect(can).toEqual({ characters: [false, true], personas: [true], presets: [true, false] });
    const pick = toPick(backup, can);
    expect(pick.characters.map((item) => item.id)).toEqual(['b']);
    expect(pick.presets).toEqual([backup.presets[0]]);
  });
});
