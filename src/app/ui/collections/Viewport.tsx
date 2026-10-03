import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RowMemoryContext, type RowMemory } from './row-memory';
import { RowSizes } from './viewport-size';
import styles from './Viewport.module.css';

type Props = {
  keys: readonly string[];
  children: (index: number) => ReactNode;
  variant?: 'story' | 'list' | 'rail' | 'grid';
  // What names the current row, such as the open chat's id. When it changes, a current row out of the list's view is
  // brought into it: a chat opened from a menu or a link may sit hundreds of rows down.
  current?: string;
  end?: boolean;
  keep?: readonly string[];
  seek?: { key: string; revision: number } | null;
};

// Uses its existing scroll ancestor: the feature keeps one scroller and one follow policy.
export function Viewport({ keys, children, variant = 'list', end = false, keep = [], seek, current }: Props) {
  const reveal = useMemo(() => current ? { key: current, revision: 0 } : null, [current]);
  const target = seek ?? reveal;
  const keyboard = useRef<{ key: string; back: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
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
  const first = useRef(true);
  const anchor = useRef<{ index: number; inside: number } | null>(null);
  const jump = useRef<Props['seek']>(null);
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
    read();
    return () => { observer.disconnect(); window.removeEventListener('resize', read); events.removeEventListener('scroll', read); scroll.current = null; };
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
    if (first.current) {
      first.current = false;
      if (end) frame.scrollTop = frame.scrollHeight;
    }
    if (target && (jump.current !== target || !view.height)) {
      const index = keys.indexOf(target.key);
      if (index >= 0) {
        const offset = offsetIn(element, frame);
        const top = offset + sizes.offset(index);
        const bottom = offset + sizes.offset(index + 1);
        if (seek || top < frame.scrollTop || bottom > frame.scrollTop + frameHeight(frame)) {
          frame.scrollTop = (top + bottom) / 2 - frameHeight(frame) / 2;
        }
      }
    }
    jump.current = target;
    update.current();
  }, [sizes, estimate, seek, target, end]);

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
    // The browser cannot anchor across unmounted rows. Correct only rows wholly above the reading position.
    if (scroll.current && position + height - delta <= view.top) scroll.current.scrollTop += delta;
    redraw((n) => n + 1);
  }

  return <div ref={root} className={`${styles.viewport} ${styles[variant]}`} style={{ height: sizes.offset(keys.length) }}>
    {[...indexes].sort((a, b) => a - b).map((index) => {
      const key = keys[index]!;
      let row = cache.current.get(key);
      if (!row) cache.current.set(key, row = { height: 0, memory: { visited: false, state: new Map() } });
      return <Measured key={key} revision={sizes} offset={sizes.offset(index)} last={index === keys.length - 1} memory={row.memory}
        onMeasure={(height) => { if (active.current === sizes) measure(index, height); }}
        rowKey={key} onTab={(back) => {
          if (variant === 'story') return false;
          const next = keys[index + (back ? -1 : 1)];
          if (!next) return false;
          keyboard.current = { key: next, back };
          setFocused(next);
          return true;
        }} onFocus={() => setFocused(key)} onBlur={() => setFocused(null)}>{children(index)}</Measured>;
    })}
  </div>;
}

function Measured({ revision, offset, last, memory, onMeasure, onFocus, onBlur, rowKey, onTab, children }: {
  rowKey: string; onTab: (back: boolean) => boolean;
  revision: RowSizes; offset: number; last: boolean; memory: RowMemory; onMeasure: (height: number) => void;
  onFocus: () => void; onBlur: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
  return <RowMemoryContext value={memory}><div ref={ref} className={`${styles.row} ${last ? styles.last : ''}`}
    data-key={rowKey} onKeyDown={(event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (event.target === controls[event.shiftKey ? 0 : controls.length - 1] && onTab(event.shiftKey)) event.preventDefault();
    }} style={{ '--viewport-offset': `${offset}px` } as CSSProperties} onFocusCapture={onFocus}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onBlur(); }}>{children}</div></RowMemoryContext>;
}

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]';
function frameHeight(frame: HTMLElement) { return frame === document.scrollingElement ? window.innerHeight : frame.clientHeight; }
function offsetIn(element: HTMLElement, frame: HTMLElement) {
  return element.getBoundingClientRect().top - (frame === document.scrollingElement ? 0 : frame.getBoundingClientRect().top) + frame.scrollTop;
}
