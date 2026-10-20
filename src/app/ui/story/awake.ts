import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// The reader's own moves over the story, not a scroll: following a reply scrolls it on every line.
const MOVES = ['wheel', 'touchmove', 'pointermove', 'keydown'];

// true from the reader's last move over the story until wait ms pass without another; wake starts the wait again.
export function useAwake(scrollRef: RefObject<HTMLElement | null>, wait: number) {
  const [awake, setAwake] = useState(false);
  const timer = useRef(0);
  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAwake(false), wait);
  }, [wait]);
  useEffect(() => {
    const frame = scrollRef.current!;
    for (const type of MOVES) frame.addEventListener(type, wake, { passive: true });
    return () => {
      for (const type of MOVES) frame.removeEventListener(type, wake);
      window.clearTimeout(timer.current);
    };
  }, [scrollRef, wake]);
  return { awake, wake };
}
