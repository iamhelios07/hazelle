import { useRef, useState, type CSSProperties, type Key, type ReactNode } from 'react';
import styles from './ToastStack.module.css';

type Props = {
  // Newest first: the first is in front, and the others wait behind it until the stack is pointed at.
  items: { key: Key; toast: ReactNode }[];
  onHold: (held: boolean) => void;
};

export function ToastStack({ items, onHold }: Props) {
  const [open, setOpen] = useState(false);
  const [heights, setHeights] = useState<ReadonlyMap<Key, number>>(() => new Map());
  const hold = (held: boolean) => {
    setOpen(held);
    onHold(held);
  };
  // One lasting ref per notice: a new one each render would detach and measure again, and render again, forever. It
  // stays after a detach too, which StrictMode runs on every mount; the refs of notices gone are dropped here.
  const refs = useRef(new Map<Key, (element: HTMLElement | null) => () => void>());
  for (const key of refs.current.keys()) if (!items.some((item) => item.key === key)) refs.current.delete(key);
  const measure = (key: Key) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (element: HTMLElement | null) => {
        const observer = new ResizeObserver(() => element && setHeights((all) => (all.get(key) === element.offsetHeight ? all : new Map(all).set(key, element.offsetHeight))));
        if (element) observer.observe(element);
        return () => {
          observer.disconnect();
          setHeights((all) => {
            if (!all.has(key)) return all;
            const rest = new Map(all);
            rest.delete(key);
            return rest;
          });
        };
      };
      refs.current.set(key, ref);
    }
    return ref;
  };
  if (items.length === 0) return null;
  const height = (key: Key) => heights.get(key) ?? 0;
  const lifts = items.map((_, index) => items.slice(0, index).reduce((sum, { key }) => sum + height(key), 0));
  const front = height(items[0]!.key);
  const total = lifts.at(-1)! + height(items.at(-1)!.key);
  return (
    <div
      className={open ? `${styles.stack} ${styles.open}` : styles.stack}
      style={{ '--front': `${front}px`, '--total': `${total}px`, '--count': items.length } as CSSProperties}
      onPointerEnter={() => hold(true)}
      onPointerLeave={() => hold(false)}
      onFocus={() => hold(true)}
      onBlur={(event) => event.currentTarget.contains(event.relatedTarget) || hold(false)}
    >
      {items.map(({ key, toast }, index) => (
        <div
          key={key}
          className={index > 0 && !open ? `${styles.item} ${styles.behind}` : styles.item}
          style={{ '--index': index, '--lift': `${lifts[index]}px` } as CSSProperties}
          inert={index > 0 && !open}
        >
          <div ref={measure(key)}>{toast}</div>
        </div>
      ))}
    </div>
  );
}
