import { useEffect, useRef, useState } from 'react';
import { editPrompt, type PromptPatch } from '../../runtime/prompts';
import { useStore } from '../session';
import { useToast } from '../toast';

const QUIET_MS = 600;

// Edits saved a moment after typing stops, the fields changed since the last save merged into one patch. Leaving the
// screen saves at once, so going back straight after typing loses nothing.
export function useAutosave(id: string) {
  const store = useStore();
  const toast = useToast();
  const pending = useRef<PromptPatch | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<'saved' | 'saving' | 'failed'>('saved');

  const flush = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await running.current;
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    running.current = editPrompt(store, id, patch).then((saved) => {
      running.current = null;
      if (!saved.ok) toast.failed(saved, '프롬프트를 저장하지 못했어요.');
      if (!pending.current) setState(saved.ok ? 'saved' : 'failed');
    });
    await running.current;
  };

  const latest = useRef(flush);
  latest.current = flush;
  useEffect(() => {
    const leave = () => void latest.current();
    // A reload or a closed tab would drop a save still on its way, so the browser asks first while one is.
    const unload = (event: BeforeUnloadEvent) => {
      if (pending.current === null && running.current === null) return;
      leave();
      event.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('beforeunload', unload);
      leave();
    };
  }, []);

  return {
    state,
    // Nothing is waiting to be saved, so the stored prompt is what the screen shows.
    idle: () => pending.current === null && running.current === null,
    queue: (patch: PromptPatch) => {
      pending.current = { ...pending.current, ...patch };
      setState('saving');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void latest.current(), QUIET_MS);
    },
    flush,
  };
}
