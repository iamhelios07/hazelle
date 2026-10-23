import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../model/chat';
import { usageFacts, usageLine } from './receipt';

const usage = { inputTokens: 12_000, cachedInputTokens: 11_040, cacheWriteInputTokens: null, outputTokens: 678, reasoningTokens: 420 };
const receipt = { usage, cost: { unit: 'usd', amount: 0.0123, source: 'price-list' }, totalMs: 8_200, firstTextMs: 1_400, modelName: 'Sonnet 5', source: 'Anthropic' } as Receipt;

describe('사용량 표시', () => {
  it('reads a reply’s tokens, cache, cost and time in a line, leaving out a cache the provider does not report', () => {
    expect(usageLine(receipt)).toBe('12,000 → 678 · 캐시 92% · 약 $0.0123 · 8.2초');
    expect(usageLine({ ...receipt, usage: null, cost: 'pending' })).toBe('사용량 알 수 없음 · 비용 확인하는 중… · 8.2초');
  });

  it('opens on the facts, an unreported cache and reasoning read as unknown', () => {
    const facts = (made: Receipt) => Object.fromEntries(usageFacts(made).map(({ label, value, notes }) => [label, [value, ...(notes ?? [])]]));
    expect(facts(receipt)).toEqual({ 입력: ['12,000', '캐시 적중 92%'], 출력: ['678', '추론 420'], 비용: ['약 $0.0123'], '걸린 시간': ['8.2초', '첫 토큰 1.4초'], 속도: ['100 tok/s'], 모델: ['Sonnet 5', 'Anthropic'] });
    expect(facts({ ...receipt, usage: { ...usage, cachedInputTokens: null, reasoningTokens: null } })).toMatchObject({ 입력: ['12,000', '캐시 적중 알 수 없음'], 출력: ['678', '추론 알 수 없음'] });
  });
});
