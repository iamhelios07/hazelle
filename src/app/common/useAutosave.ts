import { useEffect, useRef, useState } from 'react';
import { useToast } from '../toast';
import { SaveQueue, type SaveStatus, type Write } from './saveQueue';

export const SAVE_STATUS: Record<SaveStatus, string> = { saving: '저장 중', saved: '저장됨', failed: '저장 못 함' };

// One thing's fields, saved together after a pause in typing, and at once when the screen is left. Its state is one
// thing's, so a caller keys the screen by id. unsaved: what the screen changed that the store does not hold yet.
export function useAutosave<T extends object>(write: Write<T>) {
  const toast = useToast();
  const latest = useRef(write);
  latest.current = write;
  const [view, setView] = useState<{ status: SaveStatus | null; unsaved: Partial<T> }>({ status: null, unsaved: {} });
  const [queue] = useState(
    () =>
      new SaveQueue<T>(
        (patch) => latest.current(patch),
        (failure) => {
          setView({ status: queue.status, unsaved: queue.unsaved });
          if (failure) toast.failed(failure, '저장하지 못했어요.');
        },
      ),
  );

  useEffect(() => {
    // Closing or reloading the tab gives a save no time to finish, so the browser asks first.
    const unload = (event: BeforeUnloadEvent) => {
      if (!queue.busy) return;
      event.preventDefault();
      void queue.flush();
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('beforeunload', unload);
      void queue.flush();
    };
  }, [queue]);

  return { ...view, change: queue.change, save: queue.save, flush: queue.flush };
}
