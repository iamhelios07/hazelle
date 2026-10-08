import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import styles from './MarginPicture.module.css';

type Props = {
  // Slotted into the message's Story where the picture's paragraph ends; the picture stands level with it.
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
};

// A message's 삽화 in the story's left margin, so the text never moves when it lands. It follows the reader down to
// the message's end. Laid out against the message, which StoryMessage positions, whose left edge is the text's.
export function MarginPicture({ anchor, children }: Props) {
  const column = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);

  const measure = () => {
    const element = column.current!;
    const at = anchor.current ? anchor.current.getBoundingClientRect().top - element.getBoundingClientRect().top : element.offsetHeight;
    // A paragraph near the end, or a mark the bot's scripts dropped, would hang the picture below the message.
    setTop(Math.max(0, Math.min(at, element.offsetHeight - picture.current!.offsetHeight)));
  };
  // Each render, since another picture may stand after another paragraph with nothing resized.
  useLayoutEffect(measure);
  // The column is as tall as the message, so it resizes whenever the text reflows.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => measure());
    observer.observe(column.current!);
    observer.observe(picture.current!);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={column} className={styles.column} style={{ '--anchor': `${top}px` } as CSSProperties}>
      <div ref={picture} className={styles.picture}>
        {children}
      </div>
    </div>
  );
}
