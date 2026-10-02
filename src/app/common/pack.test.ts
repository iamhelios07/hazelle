import { describe, expect, it } from 'vitest';
import type { Pack } from '../../engine/import/types';
import { packHolds } from './pack';

const EMPTY: Pack = { regex: [], triggers: [], toggles: '' };

describe('what a pack holds', () => {
  it('counts each thing it has and leaves out what it has none of', () => {
    const pack: Pack = {
      ...EMPTY,
      triggers: [
        { kind: 'lua', name: '', code: '' },
        { kind: 'blocks', name: '', on: 'start', conditions: [], effects: [] },
      ],
      toggles: 'storm=폭풍\nweather=날씨',
      background: '<style></style>',
    };
    expect(packHolds(pack, 6, 0)).toBe('로어북 6개 · 트리거 2개 · 토글 2개 · 스타일');
    expect(packHolds(EMPTY, 0, 12)).toBe('에셋 12개');
  });

  it('says so when it holds nothing', () => {
    expect(packHolds(EMPTY, 0, 0)).toBe('담긴 것이 없어요');
  });
});
