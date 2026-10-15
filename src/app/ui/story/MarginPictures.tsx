import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import styles from './MarginPictures.module.css';

type Props = {
  // By picture, the element slotted into the message's Story where its paragraph ends; each stands level with its own.
  anchors: RefObject<(HTMLElement | null)[]>;
  children: ReactNode[];
};

type Place = { top: number; height: number };

// Each picture's band of the message: from where it stands to just above the next one, or to the message's end. A
// picture stands level with its paragraph, below the one before it, and within the message when they fit; when they
// do not, the last runs past the message's end rather than over another picture.
function placesOf(wanted: number[], heights: number[], end: number, gap: number): Place[] {
  const tops: number[] = [];
  for (const [index, at] of wanted.entries()) tops.push(index ? Math.max(at, tops[index - 1]! + heights[index - 1]! + gap) : Math.max(at, 0));
  for (let index = tops.length - 1; index >= 0; index--) tops[index] = Math.min(tops[index]!, (index === tops.length - 1 ? end : tops[index + 1]! - gap) - heights[index]!);
  for (const index of tops.keys()) tops[index] = index ? Math.max(tops[index]!, tops[index - 1]! + heights[index - 1]! + gap) : Math.max(tops[index]!, 0);
  return tops.map((top, index) => ({ top, height: Math.max(index === tops.length - 1 ? end - top : tops[index + 1]! - gap - top, heights[index]!) }));
}

// A message's 삽화 on the stage right of the story, so the text never moves when one lands. Each follows the reader
// down its band. Laid out against the message, which StoryMessage positions, whose right edge is the text's.
export function MarginPictures({ anchors, children }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const pictures = useRef<(HTMLDivElement | null)[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);

  const measure = () => {
    const element = stage.current!;
    const from = element.getBoundingClientRect().top;
    const end = element.offsetHeight;
    // A mark the bot's scripts dropped puts its picture at the end.
    const wanted = children.map((_, index) => {
      const anchor = anchors.current[index];
      return anchor ? anchor.getBoundingClientRect().top - from : end;
    });
    const heights = children.map((_, index) => pictures.current[index]?.offsetHeight ?? 0);
    const next = placesOf(wanted, heights, end, parseFloat(getComputedStyle(element).rowGap) || 0);
    setPlaces((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  };
  // Each render, since a picture may land or go after another paragraph with nothing resized.
  useLayoutEffect(measure);
  // The stage is as tall as the message, so it resizes whenever the text reflows.
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => measure());
    observer.observe(stage.current!);
    for (const picture of pictures.current.slice(0, children.length)) if (picture) observer.observe(picture);
    return () => observer.disconnect();
  }, [children.length]);

  return (
    <div ref={stage} className={styles.stage}>
      {children.map((child, index) => (
        <div key={index} className={styles.column} style={{ '--top': `${places[index]?.top ?? 0}px`, '--height': `${places[index]?.height ?? 0}px` } as CSSProperties}>
          <div
            ref={(element) => {
              pictures.current[index] = element;
            }}
            className={styles.picture}
          >
            {child}
          </div>
        </div>
      ))}
    </div>
  );
}
