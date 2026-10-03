import { useLayoutEffect, useRef, useState } from 'react';
import { READER_RESIZED, ROWS_RESIZED } from '../ui';

// The view starts at the bottom and follows the story while it is there; scrolled up, it stays, and a new message
// lights the 새 답장 pill instead. count and streaming are the story's; its scroller takes scrollRef.
export function useFollow(count: number, streaming: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Where toBottom left the view. Its scroll event comes after the story may have grown again, so it is not the reader
  // leaving the bottom.
  const placed = useRef<number | null>(null);
  const seen = useRef({ count, streaming });
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(false);

  const toBottom = () => {
    const element = scrollRef.current;
    if (!element || !stick.current) return;
    element.scrollTop = element.scrollHeight;
    placed.current = element.scrollTop;
  };

  useLayoutEffect(() => {
    toBottom();
    const ended = seen.current.streaming && !streaming;
    if ((count > seen.current.count || ended) && !stick.current) setUnread(true);
    seen.current = { count, streaming };
  });

  // A reply grows between the renders of the story as it is revealed (useReveal), so the view follows its size too, a
  // row's as soon as the story has it (ROWS_RESIZED); not a size the reader changed (Story sends READER_RESIZED), which
  // moves the bottom without a scroll.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    let kept = false;
    const keep = () => (kept = true);
    const grown = () => {
      if (!kept) toBottom();
    };
    const observer = new ResizeObserver(() => {
      if (!kept) toBottom();
      kept = false;
      onScroll();
    });
    observer.observe(content);
    element.addEventListener(READER_RESIZED, keep);
    element.addEventListener(ROWS_RESIZED, grown);
    return () => {
      observer.disconnect();
      element.removeEventListener(READER_RESIZED, keep);
      element.removeEventListener(ROWS_RESIZED, grown);
    };
  }, []);

  function onScroll() {
    const element = scrollRef.current!;
    if (element.scrollTop === placed.current) return;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    stick.current = bottom;
    setAway(!bottom);
    if (bottom) setUnread(false);
  }

  function follow() {
    stick.current = true;
    setAway(false);
    setUnread(false);
  }

  // Before the view is moved up from code: following would take it back down in the same render.
  function hold() {
    stick.current = false;
  }

  // What the pill over the composer says, or null while the view is at the bottom.
  const pill = !away ? null : streaming ? '답장 쓰는 중' : unread ? '새 답장' : '맨 아래로';

  return { scrollRef, onScroll, follow, hold, pill, away };
}
