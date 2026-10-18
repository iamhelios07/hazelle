import { expect, it } from 'vitest';
import { DIRECT_TYPE } from '../../contracts/pulse';
import { hourDetail, percent, providerName, rankRows, startsText } from './board';

it('names a provider by its connection type, 직접 연결 for the generic one, and none for a type this build does not list', () => {
  expect(providerName('openrouter')).toBe('OpenRouter');
  expect(providerName(DIRECT_TYPE)).toBe('직접 연결');
  expect(providerName('from-a-newer-build')).toBeNull();
});

it('ranks the split view without the rows it cannot name, and shows a model it cannot confirm as 기타', () => {
  const ranking = {
    merged: [{ model: 'GLM 5.2', share: 0.6, people: 1200, replies: 34560 }],
    split: [
      { model: 'GLM 5.2', type: 'from-a-newer-build', share: 0.5, people: 900 },
      { model: null, type: DIRECT_TYPE, share: 0.003, people: 7 },
    ],
  };
  expect(rankRows(ranking, false)).toEqual([{ rank: 1, model: 'GLM 5.2', provider: null, share: '60%', people: '1,200명', replies: '34,560번' }]);
  expect(rankRows(ranking, true)).toEqual([{ rank: 1, model: '기타', provider: '직접 연결', share: '1% 미만', people: '7명', replies: null }]);
  expect(percent(0)).toBe('0%');
});

it('tells the start in KST, and an hour by its replies first, then the roles it had', () => {
  expect(startsText(Date.UTC(2026, 9, 20, 0))).toBe('10월 20일 (화) 오전 9시');
  expect(hourDetail({ chat: 120, aux: 0, image: 10, embedding: 0 })).toBe('응답 120번 · 이미지 10번');
});
