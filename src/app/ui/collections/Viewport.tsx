import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RowMemoryContext, type RowMemory } from './row-memory';
import { RowSizes } from './viewport-size';
import styles from './Viewport.module.css';

type Props = {
  keys: readonly string[];
  children: (index: number) => ReactNode;
  variant?: 'story' | 'list' | 'items' | 'rail' | 'grid';
  // The list's name: the root is a ul and every row an li.
  list?: string;
  // What names the current row, such as the open chat's id. When it changes, a current row out of the list's view is
  // brought into it: a chat opened from a menu or a link may sit hundreds of rows down.
  current?: string;
  keep?: readonly string[];
  seek?: { key: string; revision: number } | null;
  // Tab past a row's last control mounts the next row and focuses its first; false leaves Tab to the browser.
  traverse?: boolean;
};

// Sent from the root once a row's new height is in place, before the scroll events of that frame: a follower that waits
// for its own resize observer would read the old bottom from them.
export const ROWS_RESIZED = 'rowsresized';

// Uses its existing scroll ancestor: the feature keeps one scroller and one follow policy.
export function Viewport({ keys: given, children, variant = 'list', list, keep = [], seek, current, traverse = true }: Props) {
  const stable = useRef(given);
  if (given !== stable.current && (given.length !== stable.current.length || given.some((key, index) => key !== stable.current[index]))) stable.current = given;
  const keys = stable.current;
  // Rows rise in while the view opens; once the reader or a seek has moved it, only rows of keys added since do.
  const [initial] = useState(() => new Set(keys));
  const opened = useRef(false);
  const reveal = useMemo(() => current ? { key: current, revision: 0 } : null, [current]);
  const target = seek ?? reveal;
  const keyboard = useRef<{ key: string; back: boolean } | null>(null);
  const root = useRef<HTMLDivElement & HTMLUListElement>(null);
  const cache = useRef(new Map<string, { height: number; memory: RowMemory }>());
  const [widthRevision, setWidthRevision] = useState(0);
  const [estimate, setEstimate] = useState(1);
  const [view, setView] = useState({ top: 0, height: 0 });
  const [focused, setFocused] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const sizes = useMemo(() => {
    const next = new RowSizes(keys.length, estimate);
    keys.forEach((key, index) => {
      const row = cache.current.get(key);
      if (row?.height) next.set(index, row.height);
    });
    return next;
  }, [keys, estimate, widthRevision]);
  const scroll = useRef<HTMLElement | null>(null);
  const anchor = useRef<{ index: number; inside: number } | null>(null);
  const jump = useRef<Props['seek']>(null);
  // A seek or reveal holds its row where it put it: measuring the rows above corrects the scroll, until the reader
  // moves the view.
  const held = useRef<string | null>(null);
  const reading = useRef<Reading | null>(null);
  const update = useRef<() => void>(() => {});
  const active = useRef(sizes);
  active.current = sizes;

  useLayoutEffect(() => {
    const element = root.current!;
    let parent = element.parentElement;
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    const frame = parent ?? document.scrollingElement as HTMLElement;
    scroll.current = frame;
    const events = parent ? frame : window;
    let width = element.clientWidth;
    const read = () => {
      reading.current = across(element, frame);
      const offset = offsetIn(element, frame);
      setView({ top: frame.scrollTop - offset, height: frameHeight(frame) });
    };
    update.current = read;
    setEstimate(parseFloat(getComputedStyle(element).getPropertyValue('--viewport-estimate')));
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth) {
        const offset = offsetIn(element, frame);
        const top = frame.scrollTop - offset;
        const index = active.current.at(Math.max(0, top));
        anchor.current = { index, inside: top - active.current.offset(index) };
        width = element.clientWidth;
        cache.current.forEach((row) => { row.height = 0; });
        setWidthRevision((revision) => revision + 1);
      }
      read();
    });
    observer.observe(element);
    observer.observe(frame);
    events.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    const moved = () => { held.current = null; opened.current = true; };
    for (const type of MOVES) events.addEventListener(type, moved, { passive: true });
    read();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', read);
      events.removeEventListener('scroll', read);
      for (const type of MOVES) events.removeEventListener(type, moved);
      scroll.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (focused && !root.current?.contains(document.activeElement)) setFocused(null);
  });

  useLayoutEffect(() => {
    const live = new Set(keys);
    for (const key of cache.current.keys()) if (!live.has(key)) cache.current.delete(key);
  }, [keys]);

  useLayoutEffect(() => {
    const frame = scroll.current;
    const element = root.current;
    if (!frame || !element || estimate === 1) return;
    if (anchor.current) {
      const { index, inside } = anchor.current;
      const offset = offsetIn(element, frame);
      frame.scrollTop = offset + sizes.offset(Math.min(index, keys.length)) + inside;
      anchor.current = null;
    }
    if (target && (jump.current !== target || !view.height)) {
      const index = keys.indexOf(target.key);
      if (index >= 0) {
        const offset = offsetIn(element, frame);
        const top = offset + sizes.offset(index);
        const bottom = offset + sizes.offset(index + 1);
        if (seek || top < frame.scrollTop || bottom > frame.scrollTop + frameHeight(frame)) {
          frame.scrollTop = (top + bottom) / 2 - frameHeight(frame) / 2;
          held.current = target.key;
          opened.current = true;
        }
      }
    }
    jump.current = target;
    update.current();
  }, [sizes, estimate, seek, target]);

  const from = sizes.at(Math.max(0, view.top - view.height));
  const through = sizes.at(Math.max(0, view.top + view.height * 2));
  const indexes = new Set<number>();
  for (let i = from; i <= through && i < keys.length; i++) indexes.add(i);
  for (const key of [...keep, ...(focused ? [focused] : [])]) {
    const index = keys.indexOf(key);
    if (index >= 0) indexes.add(index);
  }
  if (target && jump.current !== target) {
    const index = keys.indexOf(target.key);
    if (index >= 0) indexes.add(index);
  }

  useLayoutEffect(() => {
    const pending = keyboard.current;
    if (!pending) return;
    const row = [...root.current!.children].find((node) => (node as HTMLElement).dataset.key === pending.key);
    const controls = row?.querySelectorAll<HTMLElement>(FOCUSABLE);
    const control = controls?.[pending.back ? controls.length - 1 : 0];
    if (control) { keyboard.current = null; control.focus(); }
  });

  function measure(index: number, height: number) {
    const key = keys[index]!;
    const row = cache.current.get(key)!;
    if (Math.abs(row.height - height) < 0.5) return;
    row.height = height;
    const position = sizes.offset(index);
    const delta = sizes.set(index, height);
    const frame = scroll.current;
    if (frame) {
      const scrolled = frame.scrollTop;
      const top = scrolled - offsetIn(root.current!, frame);
      const anchor = held.current === null ? -1 : keys.indexOf(held.current);
      const crossed = reading.current?.row.dataset.key === key && reading.current.element.isConnected ? reading.current : null;
      // The browser cannot anchor across unmounted rows. Correct rows wholly above the reading position, and in the row
      // across it, by how far what was read moved.
      const correction = anchor >= 0 ? (index < anchor ? delta : 0)
        : position + height - delta <= top ? delta
        : position < top && crossed ? inside(crossed) - crossed.inside : 0;
      // The root takes its height before the render that sets it, so the correction is not clamped to the old one; and
      // from the position read before, so a clamp to the new one is not counted twice.
      root.current!.style.height = `${sizes.offset(keys.length)}px`;
      if (correction) frame.scrollTop = scrolled + correction;
      reading.current = across(root.current!, frame);
      root.current!.dispatchEvent(new Event(ROWS_RESIZED, { bubbles: true }));
    }
    redraw((n) => n + 1);
  }

  const Root = list === undefined ? 'div' : 'ul';
  return <Root ref={root} className={`${styles.viewport} ${styles[variant]}`} style={{ height: sizes.offset(keys.length) }} aria-label={list}>
    {[...indexes].sort((a, b) => a - b).map((index) => {
      const key = keys[index]!;
      let row = cache.current.get(key);
      if (!row) cache.current.set(key, row = { height: 0, memory: { visited: initial.has(key), state: new Map() } });
      if (!opened.current) row.memory.visited = false;
      return <Measured key={key} item={list !== undefined} revision={sizes} offset={sizes.offset(index)} last={index === keys.length - 1} memory={row.memory}
        onMeasure={(height) => { if (active.current === sizes) measure(index, height); }}
        rowKey={key} onTab={(back) => {
          if (!traverse) return false;
          const next = keys[index + (back ? -1 : 1)];
          if (!next) return false;
          keyboard.current = { key: next, back };
          setFocused(next);
          return true;
        }} onFocus={() => setFocused(key)} onBlur={() => setFocused(null)}>{children(index)}</Measured>;
    })}
  </Root>;
}

function Measured({ item, revision, offset, last, memory, onMeasure, onFocus, onBlur, rowKey, onTab, children }: {
  item: boolean; rowKey: string; onTab: (back: boolean) => boolean;
  revision: RowSizes; offset: number; last: boolean; memory: RowMemory; onMeasure: (height: number) => void;
  onFocus: () => void; onBlur: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);
  const Row = item ? 'li' : 'div';
  const measure = useRef(onMeasure);
  measure.current = onMeasure;
  useLayoutEffect(() => {
    const element = ref.current!;
    const read = () => measure.current(element.getBoundingClientRect().height);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    memory.visited = true;
    return () => observer.disconnect();
  }, [memory, revision]);
  return <RowMemoryContext value={memory}><Row ref={ref} className={`${styles.row} ${last ? styles.last : ''}`}
    data-key={rowKey} onKeyDown={(event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (event.target === controls[event.shiftKey ? 0 : controls.length - 1] && onTab(event.shiftKey)) event.preventDefault();
    }} style={{ '--viewport-offset': `${offset}px` } as CSSProperties} onFocusCapture={onFocus}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onBlur(); }}>{children}</Row></RowMemoryContext>;
}

// inside: from the row's top, which moves with every correction and render, while the element moves in it only as
// what is above it in the row grows.
type Reading = { row: HTMLElement; element: Element; inside: number };
const inside = ({ row, element }: Omit<Reading, 'inside'>) => element.getBoundingClientRect().top - row.getBoundingClientRect().top;

// The row across the top of the view and, inside it and its story's shadow root, the first element in flow reaching
// below that line: what the reader is reading. An overlay such as the found mark spans the row and never moves.
function across(root: HTMLElement, frame: HTMLElement): Reading | null {
  const line = frame === document.scrollingElement ? 0 : frame.getBoundingClientRect().top;
  const below = (element: Element) => element.getBoundingClientRect().bottom > line;
  const reaching = (parent: Element) => [...(parent.shadowRoot ?? parent).children].find((child) => below(child) && !/absolute|fixed/.test(getComputedStyle(child).position));
  const row = [...root.children].find(below) as HTMLElement | undefined;
  if (!row || row.getBoundingClientRect().top >= line) return null;
  let element: Element = row;
  for (let next = reaching(element); next; next = next.getBoundingClientRect().top < line ? reaching(next) : undefined) element = next;
  return { row, element, inside: inside({ row, element }) };
}

// What the reader moves the view with: a wheel, a touch, the scrollbar or a key.
const MOVES = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]';
function frameHeight(frame: HTMLElement) { return frame === document.scrollingElement ? window.innerHeight : frame.clientHeight; }
function offsetIn(element: HTMLElement, frame: HTMLElement) {
  return element.getBoundingClientRect().top - (frame === document.scrollingElement ? 0 : frame.getBoundingClientRect().top) + frame.scrollTop;
}
