// Prices come from models.dev's database, never from a table typed in here or a pricing page read (user, 2026-10-04).
// The server reads this module too (eslint/boundaries.js), so it stays data and types only.

// models.dev's provider id for each connection type it prices; a type left out costs 알 수 없음 unless its provider
// reports the cost or its model list states prices. credit: the provider bills in AI credits of $0.01 (Copilot), so a
// cost worked out from the list is shown in credits.
export const PRICE_LISTS: Readonly<Partial<Record<string, { list: string; credit?: true }>>> = {
  openrouter: { list: 'openrouter' },
  vercel: { list: 'vercel' },
  ollama: { list: 'ollama-cloud' },
  perplexity: { list: 'perplexity' },
  groq: { list: 'groq' },
  together: { list: 'togetherai' },
  cerebras: { list: 'cerebras' },
  deepinfra: { list: 'deepinfra' },
  nanogpt: { list: 'nano-gpt' },
  openai: { list: 'openai' },
  anthropic: { list: 'anthropic' },
  google: { list: 'google' },
  xai: { list: 'xai' },
  deepseek: { list: 'deepseek' },
  mistral: { list: 'mistral' },
  moonshot: { list: 'moonshotai' },
  copilot: { list: 'github-copilot', credit: true },
};

// A tier's rates replace the base ones once the request's input tokens exceed above. Tiers ascend by above.
export type PriceTier = { above: number; input: number; output: number; cacheRead: number | null; cacheWrite: number | null };

// USD per million tokens. A null cache rate is one the list does not state.
export type Rates = { input: number; output: number; cacheRead: number | null; cacheWrite: number | null; tiers: PriceTier[] };

// GET /api/prices?provider=<list>. fetchedAt is null, and models empty, until the server's first fetch has landed.
export type PriceList = { fetchedAt: number | null; models: Record<string, Rates> };
