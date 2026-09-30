import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// The view follows the story while it is at the bottom; scrolled up, it stays, and a new message
// lights the 새 답장 pill instead. count and streaming are the story's; its scroller takes scrollRef.
export function useFollow(count: number, streaming: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seen = useRef({ count, streaming });
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(false);

  const toBottom = () => {
    const element = scrollRef.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  };

  useLayoutEffect(() => {
    toBottom();
    const ended = seen.current.streaming && !streaming;
    if ((count > seen.current.count || ended) && !stick.current) setUnread(true);
    seen.current = { count, streaming };
  });

  // A reply grows between the renders of the story as it is revealed (useReveal), so the view follows its size too.
  useEffect(() => {
    const content = scrollRef.current?.firstElementChild;
    if (!content) return;
    const observer = new ResizeObserver(toBottom);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  function onScroll() {
    const element = scrollRef.current!;
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

  // What the pill over the composer says, or null while the view is at the bottom.
  const pill = !away ? null : streaming ? '답장 쓰는 중' : unread ? '새 답장' : '맨 아래로';

  return { scrollRef, onScroll, follow, pill, away };
}
