type Queue = { flush: () => Promise<boolean> };
type Removal = <R extends { ok: boolean }>(task: () => Promise<R>) => Promise<R | null>;
export type Editing = { flush: () => Promise<boolean>; remove: Removal };

// A thing an editor saves through several queues (common/useAutosave): a copy is made once all of them are written, and
// the removal runs in the owner queue's turn once the others are written, so no save writes back what it took. null:
// a change could not be written, the queue told it, and the removal did not run.
export function editing(owner: Queue & { remove: Removal }, others: Queue[]): Editing {
  const written = async (queues: Queue[]) => (await Promise.all(queues.map((queue) => queue.flush()))).every(Boolean);
  return {
    flush: () => written([owner, ...others]),
    remove: async (task) => ((await written(others)) ? owner.remove(task) : null),
  };
}
