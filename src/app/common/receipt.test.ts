import { describe, expect, it } from 'vitest';
import { usageLine } from './receipt';

const usage = { inputTokens: 12_345, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 678, reasoningTokens: null };

describe('사용량 표시', () => {
  it('reads a reply’s tokens and cost, and says an unreported usage or a cost not known or still booking as such', () => {
    expect(usageLine({ usage, cost: { unit: 'usd', amount: 0.0123, source: 'price-list' } })).toBe('입력 12,345 · 출력 678 · 약 $0.0123');
    expect(usageLine({ usage: null, cost: null })).toBe('사용량 알 수 없음 · 비용 알 수 없음');
    expect(usageLine({ usage: { ...usage, outputTokens: null }, cost: 'pending' })).toBe('입력 12,345 · 출력 알 수 없음 · 비용 확인하는 중…');
  });
});
