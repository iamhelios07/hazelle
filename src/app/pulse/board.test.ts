import { expect, it } from 'vitest';
import { DIRECT_TYPE } from '../../contracts/pulse';
import { hourDetail, percent, providerName, rankRows, startsText } from './board';

it('names a provider by its connection type, 직접 연결 for the generic one, and none for a type this build does not list', () => {
  expect(providerName('openrouter')).toBe('OpenRouter');
  expect(providerName(DIRECT_TYPE)).toBe('직접 연결');
  expect(providerName('from-a-newer-build')).toBeNull();
});

it('ranks the split view without the rows it cannot name, and puts 기타 last without a place, its bar against the largest', () => {
  const ranking = {
    merged: [
      { key: '', model: null, share: 0.5, people: 40, replies: 5000 },
      { key: 'glm 5.2', model: 'GLM 5.2', share: 0.25, people: 1200, replies: 2500 },
    ],
    split: [
      { key: 'glm 5.2', model: 'GLM 5.2', type: 'from-a-newer-build', share: 0.5, people: 900 },
      { key: '', model: null, type: DIRECT_TYPE, share: 0.003, people: 7 },
    ],
  };
  expect(rankRows(ranking, false)).toEqual([
    { key: 'glm 5.2\0', rank: 1, name: 'GLM 5.2', detail: '응답 2,500번 · 이번 주 1,200명', value: '25%', share: 0.5 },
    { key: '\0', rank: null, name: '기타', detail: '응답 5,000번 · 이번 주 40명', value: '50%', share: 1 },
  ]);
  expect(rankRows(ranking, true)).toEqual([{ key: `\0${DIRECT_TYPE}`, rank: null, name: '기타', detail: '직접 연결 · 이번 주 7명', value: '1% 미만', share: 1 }]);
  expect(percent(0)).toBe('0%');
});

it('tells the start in KST, and an hour by its replies first, then the roles it had', () => {
  expect(startsText(Date.UTC(2026, 9, 20, 0))).toBe('10월 20일 (화) 오전 9시');
  expect(hourDetail({ chat: 120, aux: 0, image: 10, embedding: 0 })).toBe('응답 120번 · 이미지 10번');
});
