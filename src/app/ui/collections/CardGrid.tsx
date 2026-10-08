import { Check } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Viewport } from './Viewport';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { useVeil } from '../foundation/veil';
import styles from './CardGrid.module.css';

const STEPS: Record<string, (columns: number) => number> = { ArrowLeft: () => -1, ArrowRight: () => 1, ArrowUp: (columns) => -columns, ArrowDown: (columns) => columns };

// face: square pictures of people (personas) at a smaller width than characters' portraits. current: the key brought
// into view when it changes.
type GridProps = { label: string; keys: readonly string[]; variant?: 'portrait' | 'face'; current?: string; children: (index: number) => ReactNode };

export function CardGrid({ label, keys, variant = 'portrait', current, children }: GridProps) {
  const root = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const element = root.current!;
    const read = () => setColumns(getComputedStyle(element).gridTemplateColumns.split(' ').length);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rows = Array.from({ length: Math.ceil(keys.length / columns) }, (_, i) => JSON.stringify(keys.slice(i * columns, (i + 1) * columns)));
  const at = current === undefined ? -1 : keys.indexOf(current);
  // Arrows move between the cards drawn; a row the viewport has not drawn yet is reached by scrolling.
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const step = STEPS[event.key];
    const cards = [...root.current!.querySelectorAll<HTMLButtonElement>(`.${styles.card}`)];
    const from = cards.indexOf(event.target as HTMLButtonElement);
    if (!step || from === -1) return;
    const to = cards[from + step(columns)];
    if (!to) return;
    event.preventDefault();
    to.focus();
  }
  return <div ref={root} className={variant === 'face' ? `${styles.grid} ${styles.face}` : styles.grid} role="group" aria-label={label} onKeyDown={move}>
    <div className={styles.window}>
      <Viewport keys={rows} variant="grid" current={at === -1 ? undefined : rows[Math.floor(at / columns)]}>{(row) => <div className={styles.cards} style={{ '--card-columns': columns } as CSSProperties}>
        {keys.slice(row * columns, (row + 1) * columns).map((key, column) => <Fragment key={key}>{children(row * columns + column)}</Fragment>)}
      </div>}</Viewport>
    </div>
  </div>;
}

type CardProps = {
  image: string | null;
  name: string;
  note: string;
  // null while the grid is not picking characters.
  selected: boolean | null;
  // The one in use, outlined, apart from a pick of several.
  current?: boolean;
  tag?: string;
  // A note that says what is missing reads fainter than a real one.
  faint?: boolean;
  onClick: () => void;
  popup?: 'menu' | 'dialog';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  menu?: ReactNode;
};

export function FaceCard({ image, name, note, selected, current = false, tag, faint = false, onClick, popup, expanded, ref, menu }: CardProps) {
  return (
    <div className={styles.cardBox}>
      <button
        ref={ref}
        type="button"
        className={[styles.card, selected && styles.selected, current && styles.current].filter(Boolean).join(' ')}
        aria-pressed={selected ?? undefined}
        aria-current={current || undefined}
        aria-haspopup={popup}
        aria-expanded={expanded}
        onClick={onClick}
      >
        <span className={styles.picture}>
          <Face image={image} name={name} />
          {selected !== null && <span className={styles.check}>{selected && <Icon icon={Check} size="xs" />}</span>}
        </span>
        <span className={styles.name}>{name}</span>
        <span className={faint ? `${styles.note} ${styles.faint}` : styles.note}>{note}</span>
        {/* After the name, so the card is named by its name first; drawn over the picture's corner. */}
        {tag && <span className={styles.tag}><Tag tone="accent">{tag}</Tag></span>}
      </button>
      {menu && <div className={styles.menu}>{menu}</div>}
    </div>
  );
}

export function Portrait({ image, name }: { image: string | null; name: string }) {
  return (
    <span className={styles.portrait}>
      <Face image={image} name={name} />
    </span>
  );
}

const TINTS = [styles.tint1, styles.tint2, styles.tint3, styles.tint4, styles.tint5];
const tint = (name: string) => TINTS[[...name].reduce((hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0, 0) % TINTS.length];

function Face({ image, name }: { image: string | null; name: string }) {
  const veil = useVeil();
  return image && !veil ? <img className={styles.image} src={image} alt="" /> : <span className={`${styles.letter} ${tint(name)}`} aria-hidden="true">{[...name][0]}</span>;
}

export function SelectionBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}
