import { describe, expect, it } from 'vitest';
import { copilotCost } from './copilot-prices';
import type { Usage } from './types';

const usage = (input: number, output: number, cached: number | null = null, written: number | null = null): Usage => ({
  inputTokens: input,
  cachedInputTokens: cached,
  cacheWriteInputTokens: written,
  outputTokens: output,
  reasoningTokens: null,
});

describe('copilot prices', () => {
  it('prices a reply in AI credits from the table, as an estimate', () => {
    // The user's first real Copilot reply: 30 tokens in, 98 out, at $4 and $20 per million.
    const cost = copilotCost('claude-opus-5.5', usage(30, 98))!;
    expect(cost).toMatchObject({ unit: 'credit', source: 'price-list' });
    expect(cost.amount).toBeCloseTo(0.208, 6);
  });

  it('prices cache reads and writes apart from fresh input', () => {
    // Anthropic's input total includes both: 5 fresh + 100 read + 20 written.
    expect(copilotCost('claude-opus-5.5', usage(125, 10, 100, 20))!.amount).toBeCloseTo((5 * 4 + 100 * 0.2 + 20 * 5 + 10 * 20) / 10_000, 9);
  });

  it('switches to the long-context rate past the threshold', () => {
    expect(copilotCost('gpt-5.4', usage(272_000, 0))!.amount).toBeCloseTo((272_000 * 2.5) / 10_000, 6);
    expect(copilotCost('gpt-5.4', usage(272_001, 0))!.amount).toBeCloseTo((272_001 * 5) / 10_000, 6);
  });

  it('has no cost for an unpriced model, a missing count, or counts that do not add up', () => {
    expect(copilotCost('claude-opus-4.6', usage(30, 98))).toBeNull();
    expect(copilotCost('claude-opus-5.5', { ...usage(30, 98), outputTokens: null })).toBeNull();
    expect(copilotCost('claude-opus-5.5', null)).toBeNull();
    expect(copilotCost('claude-opus-5.5', usage(10, 5, 20))).toBeNull();
  });
});
