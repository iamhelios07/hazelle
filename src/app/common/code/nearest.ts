import { editDistance } from '../../../engine/edit-distance';

// The known name a typo most likely meant: within two edits, compared as same reads them.
export function nearest(name: string, known: Iterable<string>, same: (name: string) => string): string | null {
  let best: { name: string; score: number } | null = null;
  for (const each of known) {
    const score = editDistance(same(name), same(each));
    if (score <= 2 && (!best || score < best.score)) best = { name: each, score };
  }
  return best?.name ?? null;
}
