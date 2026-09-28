import type { Cost, Usage } from './types';

// Copilot bills tokens in AI credits (1 credit = $0.01) and reports no cost, so a reply's cost is
// worked out here from GitHub's price table. Copied from
// https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing on 2026-09-28. The
// page can change (provider-hub's copy from five days earlier differs on GPT-5.6), so a cost from it is
// an estimate. Keyed by the ids provider-hub saw in real Copilot model lists; a model priced on the page
// under a name whose id has not been seen is left out, and its replies cost 알 수 없음.

// Dollars per million tokens. A tier applies up to maxInput input tokens; the last has no bound.
type Rate = { maxInput?: number; input: number; cached: number; cacheWrite?: number; output: number };

const PRICES: Partial<Record<string, Rate[]>> = {
  'gpt-5-mini': [{ input: 0.25, cached: 0.025, output: 2 }],
  'gpt-5.3-codex': [{ input: 1.75, cached: 0.175, output: 14 }],
  'gpt-5.4': [
    { maxInput: 272_000, input: 2.5, cached: 0.25, output: 15 },
    { input: 5, cached: 0.5, output: 22.5 },
  ],
  'gpt-5.4-mini': [{ input: 0.75, cached: 0.075, output: 4.5 }],
  'gpt-5.5': [
    { maxInput: 272_000, input: 5, cached: 0.5, output: 30 },
    { input: 10, cached: 1, output: 45 },
  ],
  'gpt-5.6-luna': [
    { maxInput: 200_000, input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
    { input: 0.4, cached: 0.04, cacheWrite: 0.5, output: 1.8 },
  ],
  'gpt-5.6-sol': [
    { maxInput: 272_000, input: 4, cached: 0.4, cacheWrite: 5, output: 20 },
    { input: 8, cached: 0.8, cacheWrite: 10, output: 30 },
  ],
  'gpt-5.6-terra': [
    { maxInput: 272_000, input: 2, cached: 0.2, cacheWrite: 2.5, output: 12 },
    { input: 4, cached: 0.4, cacheWrite: 5, output: 18 },
  ],
  'claude-haiku-4.5': [{ input: 1, cached: 0.1, cacheWrite: 1.25, output: 5 }],
  'claude-sonnet-4.6': [{ input: 3, cached: 0.3, cacheWrite: 3.75, output: 15 }],
  'claude-opus-4.7': [{ input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 }],
  'claude-opus-4.8': [{ input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 }],
  'claude-opus-4.8-fast': [{ input: 10, cached: 1, cacheWrite: 12.5, output: 50 }],
  'claude-opus-5': [{ input: 5, cached: 0.5, cacheWrite: 6.25, output: 25 }],
  'claude-opus-5.5': [{ input: 4, cached: 0.2, cacheWrite: 5, output: 20 }],
  'claude-sonnet-5': [{ input: 2, cached: 0.2, cacheWrite: 2.5, output: 10 }],
  'claude-fable-5': [{ input: 10, cached: 1, cacheWrite: 12.5, output: 50 }],
  'claude-fable-5.1': [{ input: 10, cached: 0.25, cacheWrite: 12.5, output: 50 }],
  'gemini-3.5-flash': [{ input: 1.5, cached: 0.15, output: 9 }],
  'kimi-k2.7-code': [{ input: 0.95, cached: 0.19, output: 4 }],
};

// A cache count the reply did not send counts as none, as the Anthropic input total already does
// (anthropic-messages usage). Without the input or output count there is no cost.
export function copilotCost(modelId: string, usage: Usage | null): Cost | null {
  const tiers = PRICES[modelId];
  if (!tiers || !usage || usage.inputTokens === null || usage.outputTokens === null) return null;
  const input = usage.inputTokens;
  const cached = usage.cachedInputTokens ?? 0;
  const written = usage.cacheWriteInputTokens ?? 0;
  const fresh = input - cached - written;
  if (fresh < 0) return null;
  const rate = tiers.find((tier) => tier.maxInput === undefined || input <= tier.maxInput)!;
  // Earlier OpenAI models have no cache write price: a token written to the cache is plain input.
  const dollars = (fresh * rate.input + cached * rate.cached + written * (rate.cacheWrite ?? rate.input) + usage.outputTokens * rate.output) / 1_000_000;
  return { unit: 'credit', amount: dollars * 100, source: 'price-list' };
}
