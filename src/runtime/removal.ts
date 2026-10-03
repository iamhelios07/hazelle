import { KINDS, parentKinds, type Kind, type Rule } from '../model/kinds';
import type { ApiResult } from './api';
import type { ObjectRow, ObjectStore, Pin } from './store';

const KIND_NAMES = Object.keys(KINDS) as Kind[];

// The ids of everything that goes when root is removed for good, as rounds to run one after another; the removals
// in one round may run together. The invariant: an object is removed only after everything it owns, so a removal
// that fails midway leaves the owner in place and can be tried again. Stored files stay: other objects of
// the account may name the same one (runtime/files). pin: the removal's, so the plan and the removal are of one
// timeline.
export async function planRemoval(store: ObjectStore, root: { kind: Kind; id: string }, pin: Pin): Promise<ApiResult<ObjectRow[][]>> {
  const pulled = await store.pull();
  if (pulled) return pulled;
  const rounds: ObjectRow[][] = [];
  const visit = async (object: ObjectRow): Promise<ApiResult<number>> => {
    const children: ObjectRow[] = [];
    const failed = KIND_NAMES.some((kind) => parentKinds(kind).includes(object.kind as Kind))
      ? await store.scan({ parent: object.id, metadata: true }, (row) => { children.push(row); }, pin)
      : null;
    if (failed) return failed;
    for (const kind of KIND_NAMES) {
      const rule: Rule = KINDS[kind];
      if (rule.owner?.kind !== object.kind) continue;
      const field = rule.owner.field;
      children.push(...store.list(kind).filter(({ value }) => (value as Record<string, unknown>)[field] === object.id));
    }
    let round = 0;
    for (const child of children) {
      const result = await visit(child);
      if (!result.ok) return result;
      round = Math.max(round, result.data + 1);
    }
    (rounds[round] ??= []).push(object);
    return { ok: true, data: round };
  };
  const stored = store.get(root.kind, root.id);
  if (!stored) return { ok: false, error: 'gone' };
  const result = await visit(stored);
  return result.ok ? { ok: true, data: rounds } : result;
}

// Stable within each depth: entries retain their input order, while every owner follows its children.
export function orderOwned<T extends { kind: Kind }>(objects: T[]): T[] {
  return [...objects].sort((a, b) => ownershipDepth(b.kind) - ownershipDepth(a.kind));
}

export function ownershipDepth(kind: Kind): number {
  const { owner }: Rule = KINDS[kind];
  const owners = owner ? [owner.kind] : parentKinds(kind);
  return owners.length === 0 ? 0 : Math.max(...owners.map(ownershipDepth)) + 1;
}

export function removeOwned(store: ObjectStore, root: { kind: Kind; id: string }, progress: (done: number, total: number) => void): Promise<ApiResult<null>> {
  return store.pinned((pin) => removeOn(store, root, progress, pin));
}

async function removeOn(store: ObjectStore, root: { kind: Kind; id: string }, progress: (done: number, total: number) => void, pin: Pin): Promise<ApiResult<null>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await planRemoval(store, root, pin);
    if (!plan.ok) return plan;
    const total = plan.data.reduce((sum, round) => sum + round.length, 0);
    let done = 0;
    progress(done, total);
    let conflict = false;
    for (const round of plan.data) {
      const removed = await store.removeRows(round);
      if (!removed.ok) {
        if (removed.error !== 'conflict') return removed;
        conflict = true;
        break;
      }
      progress(done += round.length, total);
    }
    if (!conflict) return { ok: true, data: null };
  }
  return { ok: false, error: 'conflict' };
}
