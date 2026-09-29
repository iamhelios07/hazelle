import { useEffect, useRef, useState } from 'react';
import type { ApiFailure } from '../../runtime/api';
import { useToast } from '../toast';

// How long typing pauses before a change is saved.
export const PAUSE = 600;

export type SaveStatus = 'saving' | 'saved' | 'failed';
export const SAVE_STATUS: Record<SaveStatus, string> = { saving: '저장 중', saved: '저장됨', failed: '저장 못 함' };

// One thing's fields, saved together after a pause in typing, and at once when the screen is left. Its state is one
// thing's, so a caller keys the screen by id.
export function useAutosave<T extends object>(write: (patch: Partial<T>) => Promise<{ ok: true } | ApiFailure>) {
  const toast = useToast();
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const waiting = useRef<Partial<T>>({});
  const timer = useRef<number | undefined>(undefined);

  async function save(patch: Partial<T>) {
    setStatus('saving');
    const saved = await write(patch);
    if (saved.ok) return setStatus('saved');
    // Kept for the next change to try again, under anything typed since.
    waiting.current = { ...patch, ...waiting.current };
    setStatus('failed');
    toast.failed(saved, '저장하지 못했어요.');
  }

  async function flush() {
    window.clearTimeout(timer.current);
    const patch = waiting.current;
    if (Object.keys(patch).length === 0) return;
    waiting.current = {};
    await save(patch);
  }

  const leave = useRef(flush);
  leave.current = flush;
  useEffect(() => () => void leave.current(), []);
  // Closing or reloading the tab gives a save no time to finish, so the browser asks first.
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (Object.keys(waiting.current).length === 0) return;
      event.preventDefault();
      void leave.current();
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);

  // An invalid value, such as a blank name, is shown but never saved, and takes back the one waiting.
  function change<K extends keyof T>(field: K, value: T[K], valid = true) {
    const next = { ...waiting.current };
    if (valid) next[field] = value;
    else delete next[field];
    waiting.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), PAUSE);
  }

  return { status, save, flush, change };
}
