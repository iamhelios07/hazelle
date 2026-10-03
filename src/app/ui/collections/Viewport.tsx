import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RowMemoryContext, type RowMemory } from './row-memory';
import { RowSizes } from './viewport-size';
import styles from './Viewport.module.css';

type Props = {
  keys: readonly string[];
  children: (index: number) => ReactNode;
  variant?: 'story' | 'list';
  end?: boolean;
  keep?: readonly string[];
  seek?: { key: string; revision: number } | null;
};

// Uses its existing scroll ancestor: the feature keeps one scroller and one follow policy.
export function Viewport({ keys, children, variant = 'list', end = false, keep = [], seek }: Props) {
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
    if (!parent) return;
    scroll.current = parent;
    const frame = parent;
    let width = element.clientWidth;
    const read = () => {
      const offset = element.getBoundingClientRect().top - frame.getBoundingClientRect().top + frame.scrollTop;
      setView({ top: frame.scrollTop - offset, height: frame.clientHeight });
    };
    update.current = read;
    setEstimate(parseFloat(getComputedStyle(element).getPropertyValue('--viewport-estimate')));
    const observer = new ResizeObserver(() => {
      if (width !== element.clientWidth) {
        const offset = element.getBoundingClientRect().top - frame.getBoundingClientRect().top + frame.scrollTop;
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
    frame.addEventListener('scroll', read, { passive: true });
    read();
    return () => { observer.disconnect(); frame.removeEventListener('scroll', read); scroll.current = null; };
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
      const offset = element.getBoundingClientRect().top - frame.getBoundingClientRect().top + frame.scrollTop;
      frame.scrollTop = offset + sizes.offset(Math.min(index, keys.length)) + inside;
      anchor.current = null;
    }
    if (first.current) {
      first.current = false;
      if (end) frame.scrollTop = frame.scrollHeight;
    }
    if (seek && (jump.current !== seek || !view.height)) {
      const index = keys.indexOf(seek.key);
      if (index >= 0) {
        const offset = element.getBoundingClientRect().top - frame.getBoundingClientRect().top + frame.scrollTop;
        frame.scrollTop = offset + (sizes.offset(index) + sizes.offset(index + 1)) / 2 - frame.clientHeight / 2;
      }
    }
    jump.current = seek;
    update.current();
  }, [sizes, estimate, seek, end]);

  const from = sizes.at(Math.max(0, view.top - view.height));
  const through = sizes.at(Math.max(0, view.top + view.height * 2));
  const indexes = new Set<number>();
  for (let i = from; i <= through && i < keys.length; i++) indexes.add(i);
  for (const key of [...keep, ...(focused ? [focused] : [])]) {
    const index = keys.indexOf(key);
    if (index >= 0) indexes.add(index);
  }
  if (seek && jump.current !== seek) {
    const index = keys.indexOf(seek.key);
    if (index >= 0) indexes.add(index);
  }

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
        onFocus={() => setFocused(key)} onBlur={() => setFocused(null)}>{children(index)}</Measured>;
    })}
  </div>;
}

function Measured({ revision, offset, last, memory, onMeasure, onFocus, onBlur, children }: {
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
    style={{ '--viewport-offset': `${offset}px` } as CSSProperties} onFocusCapture={onFocus}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onBlur(); }}>{children}</div></RowMemoryContext>;
}
