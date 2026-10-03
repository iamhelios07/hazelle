import { useLayoutEffect, useRef, useState } from 'react';
import { READER_RESIZED, ROWS_RESIZED, type Seek } from '../ui';

// The view starts at the bottom and follows the story while it is there; scrolled up, it stays, and a new message
// lights the 새 답장 pill instead. count and streaming are the story's; its scroller takes scrollRef.
// stay (보낸 자리에 멈추기): a reply starting here puts answered, the message it answers, at the top, and from then on
// nothing the story gains moves the view, not even at its end, until the pill takes it down (follow).
export function useFollow(count: number, streaming: boolean, answered: string | null, stay: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const held = useRef(false);
  // Where toBottom left the view. Its scroll event comes after the story may have grown again, so it is not the reader
  // leaving the bottom.
  const placed = useRef<number | null>(null);
  const seen = useRef({ count, streaming, answered });
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(false);
  const [seek, setSeek] = useState<Seek | null>(null);

  const toBottom = () => {
    const element = scrollRef.current;
    if (!element || !stick.current || held.current) return;
    element.scrollTop = element.scrollHeight;
    placed.current = element.scrollTop;
  };

  useLayoutEffect(() => {
    // Before following, which would take the view down first.
    if (stay && streaming && !seen.current.streaming) held.current = true;
    // The story shows the reply's messages a render or more after it starts.
    if (stay && answered !== null && answered !== seen.current.answered) {
      held.current = true;
      seekTo(answered, 'top');
    }
    toBottom();
    const ended = seen.current.streaming && !streaming;
    if ((count > seen.current.count || ended) && !stick.current) setUnread(true);
    seen.current = { count, streaming, answered };
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
    held.current = false;
    setAway(false);
    setUnread(false);
  }

  // Before a turn the user asked for: staying leaves the view for the reply's start to place.
  function beforeTurn() {
    if (!stay) follow();
  }

  // Not following, which would take the view back down in the same render.
  function seekTo(key: string, align: Seek['align']) {
    stick.current = false;
    setSeek({ key, revision: Date.now(), align });
  }

  // What the pill over the composer says, or null while the view is at the bottom.
  const pill = !away ? null : streaming ? '답장 쓰는 중' : unread ? '새 답장' : '맨 아래로';

  return { scrollRef, onScroll, follow, beforeTurn, seekTo, seek, pill, away };
}
