import type { ModelsDevList } from './models-dev';
import type { Cost, Model, Price, Usage } from './types';

// A price the provider's own model list states, in USD per million tokens; none without both its input and output rate.
export function statedPrice(input: number | null, output: number | null, cacheRead: number | null, cacheWrite: number | null): Price | undefined {
  return input === null || output === null ? undefined : { input, output, cacheRead, cacheWrite, tiers: [], asOf: null };
}

// What the model list states is the provider's own and is kept: its price, and its inputs and outputs where it does not
// leave them null. Ids match exactly, then ignoring case, never by likeness: a model models.dev names otherwise stays
// unpriced, and what it takes and gives unknown.
export function joinModelsDev(models: Model[], list: ModelsDevList | null): Model[] {
  const asOf = list?.fetchedAt;
  if (!list || !asOf) return models;
  const exact = new Map(Object.entries(list.models));
  const folded = new Map([...exact].map(([id, listed]) => [id.toLowerCase(), listed]));
  return models.map((model) => {
    const listed = exact.get(model.id) ?? folded.get(model.id.toLowerCase());
    if (!listed) return model;
    return { ...model, input: model.input ?? listed.input, output: model.output ?? listed.output, ...(!model.price && listed.price && { price: { ...listed.price, asOf } }) };
  });
}

// The tier is picked by every input token, cached ones included. Without the input or output count there is no cost; a
// cache count the reply did not send counts as none.
export function priceCost(price: Price, usage: Usage | null, unit: Cost['unit']): Cost | null {
  if (!usage || usage.inputTokens === null || usage.outputTokens === null) return null;
  const input = usage.inputTokens;
  const cached = usage.cachedInputTokens ?? 0;
  const written = usage.cacheWriteInputTokens ?? 0;
  const fresh = input - cached - written;
  if (fresh < 0) return null;
  const rates = price.tiers.findLast((tier) => input > tier.above) ?? price;
  // A cache rate the list leaves out bills the token as plain input: earlier OpenAI models have no cache write price.
  const dollars = (fresh * rates.input + cached * (rates.cacheRead ?? rates.input) + written * (rates.cacheWrite ?? rates.input) + usage.outputTokens * rates.output) / 1_000_000;
  return { unit, amount: unit === 'credit' ? dollars * 100 : dollars, source: 'price-list', ...(price.asOf === null ? {} : { asOf: price.asOf }) };
}
