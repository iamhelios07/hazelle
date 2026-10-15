import { describe, expect, it } from 'vitest';
import type { BackupCatalog } from '../../engine/import/types';
import { stepsOf, tickable, toPick } from './movePick';

describe('tickable', () => {
  it('leaves out characters and modules already brought and presets the importer refused, and picks the rest', () => {
    const backup: BackupCatalog = {
      pictures: 0,
      pictureBytes: 0,
      characters: ['a', 'b'].map((id, key) => ({ key, id, name: id, chatCount: 1, assetCount: 0, inlayCount: 0, lastTalk: 1 })),
      personas: [{ key: 0, name: 'n', alias: '' }],
      presets: [{ key: 0, name: 'p', failure: null }, { key: 1, name: 'p', failure: 'no-template' }],
      modules: ['m', 'n'].map((risu, key) => ({ key, name: risu, risu, assetCount: 0 })),
      alwaysModules: ['m'], loreBudget: null, toggles: {}, unsupported: [],
    };
    const can = tickable(backup, { characters: new Set(['a']), modules: new Set(['m']) });
    expect(can).toEqual({ characters: [false, true], personas: [true], presets: [true, false], modules: [false, true] });
    const pick = toPick(backup, can);
    expect(pick.characters.map((item) => item.id)).toEqual(['b']);
    expect(pick.presets).toEqual([backup.presets[0]]);
    expect(pick.modules).toEqual([backup.modules[1]]);
    expect(stepsOf(pick, false)).toEqual(['personas', 'modules', 'prompts', 'characters', 'chats']);
    expect(stepsOf({ ...pick, personas: [], modules: [{ key: 0, name: 'm', risu: 'm', assetCount: 2 }] }, false)).toEqual(['modules', 'prompts', 'characters', 'chats', 'pictures']);
  });
});
