import type { ChatScope } from '../engine/render';

export type Tail<T> = { from: number; items: T[] };
export function changedTail<T>(previous: readonly T[], next: readonly T[], same: (a: T, b: T) => boolean): Tail<T> {
  let from = 0;
  while (from < previous.length && from < next.length && same(previous[from]!, next[from]!)) from++;
  return { from, items: next.slice(from) };
}

// Prior revisions may still be executing; a replacement must not mutate their retained history arrays.
export const applyTail = <T>(previous: readonly T[], tail: Tail<T>): T[] => [...previous.slice(0, tail.from), ...tail.items];

const sameWrites = (a: [string, string][] | undefined, b: [string, string][] | undefined) => a === b || ((a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every(([key, value], at) => b![at]![0] === key && b![at]![1] === value));
export const sameHistory = (a: ChatScope['messages'][number], b: ChatScope['messages'][number]) => a === b || (a.id === b.id && a.seed === b.seed && a.role === b.role && a.text === b.text && a.time === b.time && a.staged === b.staged && sameWrites(a.before, b.before) && sameWrites(a.after, b.after));
