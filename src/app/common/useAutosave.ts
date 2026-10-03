import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useSaves } from '../session';
import { useToast } from '../toast';
import type { SaveStatus, Write } from './saveQueue';

export const SAVE_STATUS: Record<SaveStatus, string> = { saving: '저장 중', saved: '저장됨', failed: '저장 못 함' };

// key names the thing among the session's saves (common/saveQueue Saves), the same on every screen that edits it.
// unsaved: what was changed that the store does not hold yet, by this screen or one before it.
export function useAutosave<T extends object>(key: string, write: Write<T>) {
  const toast = useToast();
  const saves = useSaves();
  const latest = useRef(write);
  latest.current = write;
  const subscribe = useCallback((listener: () => void) => saves.watch(key, listener), [saves, key]);
  const view = useSyncExternalStore(subscribe, () => saves.view<T>(key));
  useEffect(() => () => void saves.flush(key), [saves, key]);

  const queue = () => saves.queue<T>(key, (patch) => latest.current(patch), (failure) => toast.failed(failure, '저장하지 못했어요.'));
  return {
    ...view,
    change: (patch: Partial<T>, valid?: boolean) => queue().change(patch, valid),
    save: (patch: Partial<T>) => queue().save(patch),
    flush: () => saves.flush(key),
    remove: <R extends { ok: boolean }>(task: () => Promise<R>) => queue().remove(task),
  };
}
