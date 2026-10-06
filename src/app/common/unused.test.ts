import { expect, it } from 'vitest';
import { describeUnused } from './unused';

it('picks the topic particle by the last syllable of the list', () => {
  expect(describeUnused([{ kind: 'bias', count: 142 }, { kind: 'utility', count: 1 }])).toBe('바이어스 142개 · 유틸리티 봇 설정은 대화에 적용되지 않아요.');
  expect(describeUnused([{ kind: 'utility', count: 1 }, { kind: 'bias', count: 2 }])).toBe('유틸리티 봇 설정 · 바이어스 2개는 대화에 적용되지 않아요.');
  expect(describeUnused([])).toBeNull();
});
