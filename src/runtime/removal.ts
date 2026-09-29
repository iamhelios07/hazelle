import { KINDS, type Kind, type Rule } from '../model/kinds';
import type { ObjectStore } from './store';

// A sealed file or a stored object, by id.
export type Removal = { from: 'files' | 'store'; id: string };

const KIND_NAMES = Object.keys(KINDS) as Kind[];

// Everything that goes when root is removed for good, as rounds to run one after another; the removals
// in one round may run together. The invariant: an object is removed only after everything it owns and
// after its files, so a removal that fails midway leaves the owner in place and can be tried again.
export function planRemoval(store: ObjectStore, root: { kind: Kind; id: string }): Removal[][] {
  const files: Removal[] = [];
  const rounds: Removal[][] = [];
  const visit = ({ kind, id }: { kind: Kind; id: string }): number => {
    const rule: Rule = KINDS[kind];
    if (rule.file) files.push({ from: 'files', id });
    const round = owned(store, kind, id).reduce((last, object) => Math.max(last, visit(object)), -1) + 1;
    (rounds[round] ??= []).push({ from: 'store', id });
    return round;
  };
  visit(root);
  return files.length ? [files, ...rounds] : rounds;
}

// What an object owns by either link KINDS declares: the parent, or a body field.
function owned(store: ObjectStore, owner: Kind, id: string): { kind: Kind; id: string }[] {
  return KIND_NAMES.flatMap((kind) => {
    const rule: Rule = KINDS[kind];
    const link = rule.owner;
    const byParent = rule.parent === owner ? store.children(kind, id) : [];
    const byBody = link?.kind === owner ? store.list(kind).filter(({ value }) => (value as Record<string, unknown>)[link.field] === id) : [];
    return [...byParent, ...byBody];
  });
}
