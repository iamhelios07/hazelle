import { ArrowDown, ArrowUp, Bookmark, ChevronRight, Plus, X, type LucideIcon } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { Menu, type MenuOpener } from '../overlays/Menu';
import styles from './Outline.module.css';

// The rail's sections, each drawn in its own color (tokens.css --color-kind-*).
export type OutlineKind = 'text' | 'char' | 'lore' | 'chat' | 'note';

export type OutlineStop = {
  id: string;
  kind: OutlineKind;
  icon: LucideIcon;
  title: string;
  // An unnamed text block, titled by its first line.
  dim?: boolean;
  meta?: string;
  badge?: string;
  // The gold dot: the block holds toggle conditions.
  flagged?: boolean;
  // A cache point after the stop, drawn as a dashed line under it: one set on it, or one the app sets itself.
  cache?: 'set' | 'auto';
  // What a screen reader reads for the row.
  label: string;
};

type Props = {
  label: string;
  // How the keys work, read with every row.
  help: string;
  start: string;
  end: string;
  stops: OutlineStop[];
  current: string | null;
  onPick: (id: string) => void;
  // Enter: into the block's own page or text.
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  // to is the index the stop ends at.
  onMove: (from: number, to: number) => void;
  // The menu behind each "+", for a new stop at that index; the last one is 맨 끝에 추가.
  insert: (index: number) => ReactNode;
  // Sets or takes off the cache point after a stop, from a toggle beside 빼기. A point the app sets has none.
  onCache: (id: string) => void;
  // drag: drag and Alt+↑/↓. buttons: ↑/↓ on each row instead, where there is no drag (the phone's 순서 바꾸기).
  reorder?: 'drag' | 'buttons';
  // A chevron on each row: it opens a page of its own (phone).
  drill?: boolean;
};

// A subway map of what is sent, top to bottom. The line between two stops takes the
// upper stop's color, so it changes color at the stop where the section changes, and a section change leaves a wider
// gap. Stops are one grid: number, node, title, meta.
export function Outline({ label, help, start, end, stops, current, onPick, onOpen, onRemove, onMove, insert, onCache, reorder = 'drag', drill = false }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const [drag, setDrag] = useState<{ from: number; at: number } | null>(null);
  // The row to focus once the stops have changed under it: moved, or next after a removal.
  const refocus = useRef<string | null>(null);

  const focusStop = (id: string) => list.current?.querySelector<HTMLElement>(`[data-stop="${CSS.escape(id)}"]`)?.focus();

  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    focusStop(id);
  }, [stops]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= stops.length || to === from) return;
    refocus.current = stops[from]!.id;
    onMove(from, to);
  };

  const key = (event: KeyboardEvent, index: number) => {
    const stop = stops[index]!;
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (step !== 0) {
      event.preventDefault();
      if (event.altKey) return move(index, index + step);
      const next = stops[index + step];
      if (!next) return;
      onPick(next.id);
      focusStop(next.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(stop.id);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      refocus.current = (stops[index + 1] ?? stops[index - 1])?.id ?? null;
      onRemove(stop.id);
    }
  };

  const over = (event: DragEvent, index: number) => {
    if (!drag) return;
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const at = event.clientY > box.top + box.height / 2 ? index + 1 : index;
    if (at !== drag.at) setDrag({ ...drag, at });
  };
  const drop = (event: DragEvent) => {
    if (!drag) return;
    event.preventDefault();
    move(drag.from, drag.at > drag.from ? drag.at - 1 : drag.at);
    setDrag(null);
  };

  const addMenu = (index: number, trigger: (opener: MenuOpener) => ReactNode) => (
    <Menu label="블록 추가" size="lg" place="below-start" trigger={trigger}>
      {insert(index)}
    </Menu>
  );
  const plus = (index: number, where: string) => (
    <span className={styles.plusAt}>
      {addMenu(index, (opener) => (
        <button type="button" className={styles.plus} aria-label={where} title="여기에 추가" ref={opener.ref} aria-haspopup="menu" aria-expanded={opener.expanded} onClick={opener.onClick}>
          <Icon icon={Plus} size="xs" />
        </button>
      ))}
    </span>
  );

  const cut = (stop: OutlineStop | undefined) =>
    stop?.cache && (
      <span className={`${styles.cut} ${styles[stop.cache]}`} aria-hidden>
        <span className={styles.cutLabel}>
          <Icon icon={Bookmark} size="xs" />
          {stop.cache === 'set' ? '여기까지 캐시' : '자동 캐시'}
        </span>
      </span>
    );
  const lastStop = stops.at(-1);

  return (
    <div className={[styles.outline, reorder === 'buttons' && styles.buttons, drill && styles.drill].filter(Boolean).join(' ')} ref={list}>
      <span id={helpId} className={styles.help}>
        {help}
      </span>
      <div className={styles.cap} aria-hidden>
        <span className={`${styles.end} ${styles.open}`} />
        <span className={styles.capLabel}>{start}</span>
      </div>
      <div role="list" aria-label={label} className={lastStop?.cache ? `${styles.stops} ${styles.cutEnd}` : styles.stops} onDragOver={(event) => drag && event.preventDefault()} onDrop={drop}>
        {stops.map((stop, index) => {
          const above = stops[index - 1];
          const turn = above !== undefined && above.kind !== stop.kind;
          const classes = [styles.stop, turn && styles.turn, above?.cache && styles.cutAbove, index === 0 && styles.first, drag?.from === index && styles.dragged].filter(Boolean).join(' ');
          return (
            <div key={stop.id} role="listitem" className={classes} onDragOver={(event) => over(event, index)}>
              <span className={`${styles.segment} ${styles[above?.kind ?? stop.kind]}`} aria-hidden />
              {index === stops.length - 1 && <span className={`${styles.segment} ${styles.last} ${styles[stop.kind]}`} aria-hidden />}
              <div className={styles.gap}>
                {cut(above)}
                {drag?.at === index && <span className={styles.drop} />}
                {reorder === 'drag' && plus(index, `${index + 1}번째 자리에 추가`)}
              </div>
              <div className={styles.row} aria-current={stop.id === current || undefined}>
                <button
                  type="button"
                  className={styles.button}
                  data-stop={stop.id}
                  draggable={reorder === 'drag'}
                  aria-label={stop.label}
                  aria-describedby={helpId}
                  aria-current={stop.id === current || undefined}
                  onClick={() => onPick(stop.id)}
                  onKeyDown={(event) => key(event, index)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', stop.id);
                    event.dataTransfer.effectAllowed = 'move';
                    setDrag({ from: index, at: index });
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <span className={styles.number}>{index + 1}</span>
                  <span className={`${styles.node} ${styles[stop.kind]}`}>
                    <stop.icon className={styles.glyph} aria-hidden />
                    {stop.flagged && <span className={styles.dot} title="토글 조건이 들어 있어요" />}
                  </span>
                  <span className={styles.title}>
                    <span className={stop.dim ? `${styles.name} ${styles.dim}` : styles.name}>{stop.title}</span>
                    {stop.badge && <Tag tone="accent">{stop.badge}</Tag>}
                  </span>
                  {reorder === 'drag' && <span className={styles.meta}>{stop.meta}</span>}
                  {drill && reorder === 'drag' && <Icon icon={ChevronRight} size="xs" />}
                </button>
                {reorder === 'drag' ? (
                  <span className={styles.tools}>
                    {stop.cache !== 'auto' && (
                      <IconButton
                        icon={Bookmark}
                        size="xs"
                        label={`‘${stop.title}’까지 캐시`}
                        title={stop.cache ? '캐시 지점 빼기' : '여기까지 캐시'}
                        pressed={stop.cache === 'set'}
                        onClick={() => onCache(stop.id)}
                      />
                    )}
                    <IconButton icon={X} size="xs" label={`‘${stop.title}’ 빼기`} title="빼기" onClick={() => onRemove(stop.id)} />
                  </span>
                ) : (
                  <span className={styles.arrows}>
                    <IconButton icon={ArrowUp} size="xs" label={`‘${stop.title}’ 위로`} disabled={index === 0} onClick={() => move(index, index - 1)} />
                    <IconButton icon={ArrowDown} size="xs" label={`‘${stop.title}’ 아래로`} disabled={index === stops.length - 1} onClick={() => move(index, index + 1)} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div className={styles.tail}>
          {cut(lastStop)}
          {drag?.at === stops.length && <span className={styles.drop} />}
        </div>
      </div>
      <div className={styles.cap} aria-hidden>
        <span className={`${styles.end} ${styles.closed}`} />
        <span className={styles.capLabel}>{end}</span>
      </div>
      {reorder === 'drag' &&
        addMenu(stops.length, (opener) => (
          <button type="button" className={styles.append} ref={opener.ref} aria-haspopup="menu" aria-expanded={opener.expanded} onClick={opener.onClick}>
            <Icon icon={Plus} size="xs" />
            <span>맨 끝에 추가</span>
          </button>
        ))}
    </div>
  );
}
