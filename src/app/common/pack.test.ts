import { describe, expect, it } from 'vitest';
import type { Pack } from '../../engine/import/types';
import { packHolds, packParts, scriptHolds } from './pack';

const EMPTY: Pack = { regex: [], triggers: [], toggles: '' };

describe('what a pack holds', () => {
  it('counts each thing it has and leaves out what it has none of', () => {
    const pack: Pack = {
      ...EMPTY,
      triggers: [
        { kind: 'lua', id: 'trigger-0', name: '', code: '' },
        { kind: 'blocks', id: 'trigger-1', name: '', on: 'start', conditions: [], effects: [] },
      ],
      toggles: 'storm=폭풍\nweather=날씨',
      background: '<style></style>',
    };
    expect(packHolds(pack, 6, 0)).toBe('로어북 6개 · 트리거 2개 · 토글 2개 · 스타일');
    expect(packHolds(EMPTY, 0, 12)).toBe('에셋 12개');
    expect(scriptHolds(pack)).toBe('트리거 2개');
  });

  it('says so when it holds nothing', () => {
    expect(packHolds(EMPTY, 0, 0)).toBe('담긴 것이 없어요');
  });

  it('gives each part as a count the contents line is written from', () => {
    const pack: Pack = { regex: [], triggers: [{ kind: 'lua', id: 'trigger-0', name: '', code: '' }], toggles: 'storm=폭풍\n=\nweather=날씨', background: '<style></style>' };
    expect(packParts(pack, 6, 2, true)).toEqual({ tool: true, lore: 6, regex: 0, triggers: 1, toggles: 2, assets: 2, style: true });
    expect(packParts(EMPTY, 0, 0)).toEqual({ tool: false, lore: 0, regex: 0, triggers: 0, toggles: 0, assets: 0, style: false });
  });
});
