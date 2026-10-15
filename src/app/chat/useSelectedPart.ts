import { useEffect, useRef, useState, type RefObject } from 'react';
import { storySelection, type SelectionEnd } from '../ui';
import type { EditPart } from './useMessageEdit';

export type SelectedPart = { part: Omit<EditPart, 'value'>; end: SelectionEnd };

// The part selected in a story while active, read again as the selection or the view moves; null while what is
// selected is no part find knows.
export function useSelectedPart(story: RefObject<HTMLDivElement | null>, find: (pieces: string[]) => SelectedPart['part'] | null, active: boolean) {
  const [selected, setSelected] = useState<SelectedPart | null>(null);
  const latest = useRef(find);
  latest.current = find;
  useEffect(() => {
    if (!active) return;
    const read = () => {
      const selection = story.current && storySelection(story.current);
      const part = selection && latest.current(selection.pieces);
      setSelected(part ? { part, end: selection.end } : null);
    };
    read();
    document.addEventListener('selectionchange', read);
    window.addEventListener('scroll', read, { capture: true, passive: true });
    return () => {
      document.removeEventListener('selectionchange', read);
      window.removeEventListener('scroll', read, { capture: true });
    };
  }, [active, story]);
  return active ? selected : null;
}
