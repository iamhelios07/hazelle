import { describe, expect, it } from 'vitest';
import type { Toggle } from './prompt';
import { chatToggles, toggleValue } from './toggles';

const check = (key: string, label: string): Toggle => ({ key, label, kind: 'check', default: '0' });

describe('toggles', () => {
  it("declares the prompt's toggles then the card's, one per key, and reads a value over its default", () => {
    const declared = chatToggles([check('sims', '시뮬레이터 모드')], [check('sims', 'Sims'), check('nsfw', 'NSFW')]);
    expect(declared.map(({ label }) => label)).toEqual(['시뮬레이터 모드', 'NSFW']);
    const value = toggleValue(declared, { nsfw: '1', gone: '1' });
    expect([value('sims'), value('nsfw'), value('gone'), value('constructor')]).toEqual(['0', '1', null, null]);
  });
});
