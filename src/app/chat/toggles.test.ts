import { describe, expect, it } from 'vitest';
import type { Character } from '../../model/library';
import type { Toggle } from '../../model/prompt';
import { shownRows, toggleRows } from './toggles';

const PROMPT: Toggle[] = [
  { key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' },
  { key: 'length', label: '대사 길이', kind: 'choice', options: ['짧게', '보통', '길게'], default: '1' },
];
const character = (toggles: Character['toggles']) => ({ card: { toggles: 'sims=겹침\nstorm=폭풍 이벤트\nweather=날씨 묘사' }, toggles }) as unknown as Character;

describe('toggle panel rows', () => {
  it('lists the prompt’s toggles, then the card’s it does not declare, counts those off their default, and keeps the ones changed at opening first', () => {
    const rows = toggleRows(PROMPT, character({ length: '2', weather: '0', storm: '1' }), { sims: '1' });
    expect(rows.prompt.map(({ toggle, value, changed }) => [toggle.key, value, changed])).toEqual([
      ['sims', '0', false],
      ['length', '2', true],
    ]);
    expect(rows.card.map(({ toggle, changed }) => [toggle.key, changed])).toEqual([
      ['storm', true],
      ['weather', false],
    ]);
    expect(rows.changed).toBe(2);
    expect(toggleRows(PROMPT, null, { sims: '1' }).changed).toBe(1);

    expect(shownRows(rows.card, '', false, new Set(['weather'])).map(({ toggle }) => toggle.key)).toEqual(['weather', 'storm']);
    expect(shownRows(rows.card, '', true, new Set()).map(({ toggle }) => toggle.key)).toEqual(['storm']);
    expect(shownRows(rows.card, '날씨', false, new Set()).map(({ toggle }) => toggle.key)).toEqual(['weather']);
  });
});
