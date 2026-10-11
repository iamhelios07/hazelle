import { describe, expect, it } from 'vitest';
import type { Toggle } from './prompt';
import { chatToggles, toggleValue } from './toggles';

const check = (key: string, label: string): Toggle => ({ key, label, kind: 'check', default: '0' });

describe('toggles', () => {
  it("declares the prompt's toggles then the card's, one per key and none for a layout line, and reads a value over its default", () => {
    const declared = chatToggles([
      { kind: 'group', label: '모드' },
      check('sims', '시뮬레이터 모드'),
      { kind: 'groupEnd' },
      check('sims', 'Sims'),
      { kind: 'divider', label: '' },
      check('nsfw', 'NSFW'),
      { key: 'name', label: '이름', kind: 'text', default: '' },
    ]);
    expect(declared.map(({ label }) => label)).toEqual(['시뮬레이터 모드', 'NSFW', '이름']);
    const value = toggleValue(declared, { nsfw: '1', gone: '1', name: '하늘' });
    expect([value('sims'), value('nsfw'), value('name'), value('gone'), value('constructor')]).toEqual(['0', '1', '하늘', null, null]);
  });
});
