import type { Acting } from './state';

// Risu's: the values, most alike to source first, the source embedded as a search and the values as what is searched,
// as Risu's own memory embeds them. undefined when a call is refused or fails.
export async function ranked(run: Acting, source: string, documents: string[]): Promise<string[] | undefined> {
  const query = await run.host.embed([source], 'query', run.owner);
  if (!query.ok) return undefined;
  const stored = await run.host.embed(documents, 'document', run.owner);
  if (!stored.ok) return undefined;
  const scores = stored.vectors.map((vector) => cosine(query.vectors[0]!, vector));
  return documents.map((value, index) => ({ value, score: scores[index]! })).sort((a, b) => b.score - a.score).map(({ value }) => value);
}

// Risu ranks by the dot product, which equals this for the normalized vectors most models answer; for the others
// (Perplexity's) the dot product ranks by length too.
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    left += a[i]! * a[i]!;
  }
  for (const value of b) right += value * value;
  return left && right ? dot / Math.sqrt(left * right) : 0;
}
