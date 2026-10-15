import { useRef, useState, type CSSProperties, type Key, type PointerEvent, type ReactNode } from 'react';
import styles from './ToastStack.module.css';

type Props = {
  // Newest first: the first is in front, and the others wait behind it until the stack is pointed at. onClose: a
  // finger sliding the notice sideways puts it away.
  items: { key: Key; toast: ReactNode; onClose?: () => void }[];
  // Held, the stack is open and its notices' time stopped; the caller owns it, since it outlives the stack.
  held: boolean;
  onHold: (held: boolean) => void;
};

export function ToastStack({ items, held: open, onHold: hold }: Props) {
  const [heights, setHeights] = useState<ReadonlyMap<Key, number>>(() => new Map());
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
      onPointerEnter={(event) => event.pointerType === 'mouse' && hold(true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && hold(false)}
      onFocus={() => hold(true)}
      onBlur={(event) => event.currentTarget.contains(event.relatedTarget) || hold(false)}
    >
      {items.map(({ key, toast, onClose }, index) => (
        <div
          key={key}
          className={index > 0 && !open ? `${styles.item} ${styles.behind}` : styles.item}
          style={{ '--index': index, '--lift': `${lifts[index]}px` } as CSSProperties}
          inert={index > 0 && !open}
        >
          <Swiped measure={measure(key)} onClose={onClose}>
            {toast}
          </Swiped>
        </div>
      ))}
    </div>
  );
}

// Past this a finger's move is a slide, not a press: 되돌리기 under it is not pressed, and a vertical move is left to
// a long notice's own scroll.
const SLIDE = 8;

// A mouse's drag is left to selecting text; its notices have a ×.
function Swiped({ measure, onClose, children }: { measure: (element: HTMLElement | null) => () => void; onClose?: () => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [shift, setShift] = useState<number | null>(null);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (onClose && event.pointerType !== 'mouse') start.current = { x: event.clientX, y: event.clientY };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const x = event.clientX - start.current.x;
    if (shift !== null) return setShift(x);
    const y = event.clientY - start.current.y;
    if (Math.abs(x) > SLIDE && Math.abs(x) > Math.abs(y)) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setShift(x);
    } else if (Math.abs(y) > SLIDE) start.current = null;
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    start.current = null;
    if (shift !== null && Math.abs(shift) > event.currentTarget.offsetWidth / 3) onClose!();
    else setShift(null);
  };
  return (
    <div
      ref={measure}
      className={shift === null ? styles.swiped : `${styles.swiped} ${styles.sliding}`}
      style={shift === null ? undefined : ({ '--shift': `${shift}px` } as CSSProperties)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => ((start.current = null), setShift(null))}
    >
      {children}
    </div>
  );
}
