import { useLayoutEffect, useRef, useState } from 'react';
import { READER_RESIZED, ROWS_RESIZED, traceScroll, traceScroller, type Seek } from '../ui';

// It stays
// there until it is well above, and comes back only at the very end, so scrolling into the band does not snap it down.
export const atEnd = (distance: number, was: boolean) => distance < (was ? 48 : 1);

// stay (보낸 자리에 멈추기): a reply starting here puts answered, the message it answers, at the top, and from then on nothing
// the story gains moves the view, not even at its end, until the pill takes it down (follow).
export function useFollow(count: number, streaming: boolean, answered: string | null, stay: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const held = useRef(false);
  // Where toBottom left the view. Its scroll event comes after the story may have grown again, so it is not the reader
  // leaving the bottom.
  const placed = useRef<number | null>(null);
  // A screen mounted while its reply is still being written (the chat left and come back to) treats that reply as
  // starting now, so stay holds it too.
  const seen = useRef({ count, streaming: false, answered: null as string | null });
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(false);
  const [seek, setSeek] = useState<Seek | null>(null);

  const toBottom = () => {
    const element = scrollRef.current;
    if (!element || !stick.current || held.current) return;
    traceScroll('follow: to bottom');
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
    if (streaming !== seen.current.streaming || answered !== seen.current.answered) traceScroll('follow: turn', { stay, streaming, answered, held: held.current, stick: stick.current });
    seen.current = { count, streaming, answered };
  });

  // A reply grows between the renders of the story as it is revealed (useReveal), so the view follows its size too, a
  // row's as soon as the story has it (ROWS_RESIZED); not a size the reader changed (Story sends READER_RESIZED), which
  // moves the bottom without a scroll. The border box holds the room kept for the composer, which grows as it is typed in.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = element?.firstElementChild;
    if (!element || !content) return;
    const untrace = traceScroller(element);
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
    observer.observe(content, { box: 'border-box' });
    element.addEventListener(READER_RESIZED, keep);
    element.addEventListener(ROWS_RESIZED, grown);
    return () => {
      observer.disconnect();
      untrace();
      element.removeEventListener(READER_RESIZED, keep);
      element.removeEventListener(ROWS_RESIZED, grown);
    };
  }, []);

  function onScroll() {
    const element = scrollRef.current!;
    if (element.scrollTop === placed.current) return;
    placed.current = null;
    const bottom = atEnd(element.scrollHeight - element.scrollTop - element.clientHeight, stick.current);
    if (bottom !== stick.current) traceScroll('follow: stick', { stick: bottom, held: held.current, top: element.scrollTop, height: element.scrollHeight });
    stick.current = bottom;
    setAway(!bottom);
    if (bottom) setUnread(false);
  }

  function follow() {
    traceScroll('follow: released');
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
    traceScroll('follow: seek', { key, align });
    stick.current = false;
    setSeek({ key, revision: Date.now(), align });
  }

  // null while the view is at the bottom.
  const pill = !away ? null : streaming ? '생성 중' : unread ? '새 응답' : '맨 아래로';

  return { scrollRef, onScroll, follow, beforeTurn, seekTo, seek, pill, away };
}
