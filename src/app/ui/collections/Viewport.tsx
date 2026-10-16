import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TAB_STOPS } from '../overlays/layers';
import { RowMemoryContext, type RowMemory } from './row-memory';
import { RowSizes } from './viewport-size';
import styles from './Viewport.module.css';

type Props = {
  keys: readonly string[];
  children: (index: number) => ReactNode;
  variant?: 'story' | 'list' | 'items' | 'rail' | 'grid';
  list?: string;
  // When it changes, a current row out of the list's view is brought into it.
  current?: string;
  keep?: readonly string[];
  seek?: Seek | null;
  // Tab past a row's last control mounts the next row and focuses its first; false leaves Tab to the browser.
  traverse?: boolean;
};

// top: the row's top at the scroller's scroll-padding-top, which a header floating over it sets.
export type Seek = { key: string; revision: number; align: 'center' | 'top' };

// Sent from the root once a row's new height is in place, before the scroll events of that frame: a follower that waits
// for its own resize observer would read the old bottom from them.
export const ROWS_RESIZED = 'rowsresized';

// Uses its existing scroll ancestor: the feature keeps one scroller and one follow policy.
export function Viewport({ keys: given, children, variant = 'list', list, keep = [], seek, current, traverse = true }: Props) {
  const stable = useRef(given);
  if (given !== stable.current && (given.length !== stable.current.length || given.some((key, index) => key !== stable.current[index]))) stable.current = given;
  const keys = stable.current;
  const [initial] = useState(() => new Set(keys));
  const opened = useRef(false);
  const reveal = useMemo<Seek | null>(() => current ? { key: current, revision: 0, align: 'center' } : null, [current]);
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
  // A top seek keeps room below its row for it to stay at the top while what follows it is shorter than the view:
  // below is from the row's top to the root's end, so rows above it may still change size.
  const room = useRef<{ key: string; below: number } | null>(null);
  const rootHeight = () => {
    const index = room.current ? keys.indexOf(room.current.key) : -1;
    return Math.max(sizes.offset(keys.length), index < 0 ? 0 : sizes.offset(index) + room.current!.below);
  };
  // Measured again whenever the scroller's space after the rows changes, such as the composer's as it unfolds: a
  // shrink would clamp the held row below its line, and nothing would bring it back.
  const fit = useRef<(seek?: boolean) => void>(() => {});
  fit.current = (seek = false) => {
    const frame = scroll.current;
    const element = root.current;
    const index = room.current ? keys.indexOf(room.current.key) : -1;
    if (!frame || !element || index < 0) return;
    // auto, the scroller's default, is no padding.
    const line = parseFloat(getComputedStyle(frame).scrollPaddingTop) || 0;
    const offset = offsetIn(element, frame);
    const end = frame.scrollHeight - offset - element.offsetHeight;
    room.current!.below = frameHeight(frame) - line - end;
    // Before the scroll, which the old height would clamp.
    element.style.height = `${rootHeight()}px`;
    // After the seek, only up to the line: a scroll past it is the view sent down from outside, such as to follow the reply.
    const at = offset + sizes.offset(index) - line;
    if (seek || (held.current === room.current!.key && frame.scrollTop < at)) frame.scrollTop = at;
  };
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
      fit.current();
      read();
    });
    observer.observe(element);
    observer.observe(frame);
    if (element.parentElement !== frame) observer.observe(element.parentElement!, { box: 'border-box' });
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
          held.current = target.key;
          if (target.align === 'top') {
            room.current = { key: target.key, below: 0 };
            fit.current(true);
          } else frame.scrollTop = (top + bottom) / 2 - frameHeight(frame) / 2;
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
    const controls = row?.querySelectorAll<HTMLElement>(TAB_STOPS);
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
      const crossed = reading.current?.row.dataset.key === key ? reading.current : null;
      // A story drawn again, as when a message flips to its original, replaced what was read: the element at its place
      // stands in for it.
      const read = crossed && (crossed.element.isConnected ? crossed.element : at(crossed.row, crossed.path));
      // The browser cannot anchor across unmounted rows. Correct rows wholly above the reading position, and in the row
      // across it, by how far what was read moved.
      const correction = anchor >= 0 ? (index < anchor ? delta : 0)
        : position + height - delta <= top ? delta
        : position < top && crossed && read ? inside({ row: crossed.row, element: read }) - crossed.inside : 0;
      // The root takes its height before the render that sets it, so the correction is not clamped to the old one; and
      // from the position read before, so a clamp to the new one is not counted twice.
      root.current!.style.height = `${rootHeight()}px`;
      if (correction) frame.scrollTop = scrolled + correction;
      reading.current = across(root.current!, frame);
      root.current!.dispatchEvent(new Event(ROWS_RESIZED, { bubbles: true }));
    }
    redraw((n) => n + 1);
  }

  const Root = list === undefined ? 'div' : 'ul';
  return <Root ref={root} className={`${styles.viewport} ${styles[variant]}`} style={{ height: rootHeight() }} aria-label={list}>
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
      const controls = event.currentTarget.querySelectorAll<HTMLElement>(TAB_STOPS);
      if (event.target === controls[event.shiftKey ? 0 : controls.length - 1] && onTab(event.shiftKey)) event.preventDefault();
    }} style={{ '--viewport-offset': `${offset}px` } as CSSProperties} onFocusCapture={onFocus}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onBlur(); }}>{children}</Row></RowMemoryContext>;
}

// inside: from the row's top, which moves with every correction and render, while the element moves in it only as
// what is above it in the row grows.
// path: the element's index among its parent's children, from the row down.
type Reading = { row: HTMLElement; element: Element; path: number[]; inside: number };
const inside = ({ row, element }: Pick<Reading, 'row' | 'element'>) => element.getBoundingClientRect().top - row.getBoundingClientRect().top;
const childrenOf = (parent: Element) => [...(parent.shadowRoot ?? parent).children];
const at = (row: Element, path: number[]) => path.reduce<Element | undefined>((parent, index) => parent && childrenOf(parent)[index], row) ?? null;

// The row across the top of the view and, inside it and its story's shadow root, the first element in flow reaching
// below that line: what the reader is reading. An overlay such as the found mark spans the row and never moves.
function across(root: HTMLElement, frame: HTMLElement): Reading | null {
  const line = frame === document.scrollingElement ? 0 : frame.getBoundingClientRect().top;
  const below = (element: Element) => element.getBoundingClientRect().bottom > line;
  const reaching = (parent: Element) => childrenOf(parent).findIndex((child) => below(child) && !/absolute|fixed/.test(getComputedStyle(child).position));
  const row = [...root.children].find(below) as HTMLElement | undefined;
  if (!row || row.getBoundingClientRect().top >= line) return null;
  let element: Element = row;
  const path: number[] = [];
  for (let index = reaching(element); index !== -1; ) {
    element = childrenOf(element)[index]!;
    path.push(index);
    index = element.getBoundingClientRect().top < line ? reaching(element) : -1;
  }
  return { row, element, path, inside: inside({ row, element }) };
}

const MOVES = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
function frameHeight(frame: HTMLElement) { return frame === document.scrollingElement ? window.innerHeight : frame.clientHeight; }
function offsetIn(element: HTMLElement, frame: HTMLElement) {
  return element.getBoundingClientRect().top - (frame === document.scrollingElement ? 0 : frame.getBoundingClientRect().top) + frame.scrollTop;
}
