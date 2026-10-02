import { describe, expect, it } from 'vitest';
import { readToggles } from '../../engine/import/toggles';
import type { Toggle, ToggleValues } from '../../model/prompt';
import { chatToggles, toggleValue } from '../../model/toggles';
import { shownRows, splitByCard, toggleRows } from './toggles';

const PROMPT: Toggle[] = [
  { key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' },
  { key: 'length', label: '대사 길이', kind: 'choice', options: ['짧게', '보통', '길게'], default: '1' },
];
const CARD = readToggles('sims=겹침\nstorm=폭풍 이벤트\nweather=날씨 묘사').toggles;
const set = (card: Toggle[], values: ToggleValues) => {
  const declared = chatToggles(PROMPT, card);
  return { declared, value: toggleValue(declared, values) };
};

describe('toggle panel rows', () => {
  it('lists the prompt’s toggles, then the card’s it does not declare, counts those off their default, and keeps the ones changed at opening first', () => {
    const rows = toggleRows(set(CARD, { length: '2', weather: '0', storm: '1' }), PROMPT.length);
    expect(rows.prompt.map(({ toggle, value, changed }) => [toggle.key, value, changed])).toEqual([
      ['sims', '0', false],
      ['length', '2', true],
    ]);
    expect(rows.card.map(({ toggle, changed }) => [toggle.key, changed])).toEqual([
      ['storm', true],
      ['weather', false],
    ]);
    expect(rows.changed).toBe(2);
    expect(toggleRows(set([], { sims: '1' }), PROMPT.length).changed).toBe(1);

    expect(shownRows(rows.card, '', false, new Set(['weather'])).map(({ toggle }) => toggle.key)).toEqual(['weather', 'storm']);
    expect(shownRows(rows.card, '', true, new Set()).map(({ toggle }) => toggle.key)).toEqual(['storm']);
    expect(shownRows(rows.card, '날씨', false, new Set()).map(({ toggle }) => toggle.key)).toEqual(['weather']);
  });

  it('sets a module’s toggles apart from the card’s, and a key both declare with the card’s', () => {
    const text = 'storm=폭풍 이벤트';
    const rows = toggleRows(set([...readToggles(text).toggles, ...readToggles('storm=모듈의 폭풍\nfog=안개').toggles], {}), PROMPT.length);
    const split = splitByCard(rows.card, text);
    expect(split.card.map(({ toggle }) => toggle.label)).toEqual(['폭풍 이벤트']);
    expect(split.modules.map(({ toggle }) => toggle.key)).toEqual(['fog']);
    expect(splitByCard(rows.card, '').card).toEqual([]);
  });
});
