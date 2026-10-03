import { Check } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Viewport } from './Viewport';
import { Icon } from '../foundation/Icon';
import styles from './CardGrid.module.css';

export function CardGrid({ label, keys, children }: { label: string; keys: readonly string[]; children: (index: number) => ReactNode }) {
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
  return <div ref={root} className={styles.grid} role="group" aria-label={label}>
    <div className={styles.window}>
      <Viewport keys={rows} variant="grid">{(row) => <div className={styles.cards} style={{ '--card-columns': columns } as CSSProperties}>
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
  onClick: () => void;
  popup?: 'menu' | 'dialog';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  menu?: ReactNode;
};

export function FaceCard({ image, name, note, selected, onClick, popup, expanded, ref, menu }: CardProps) {
  return (
    <div className={styles.cardBox}>
      <button
        ref={ref}
        type="button"
        className={selected ? `${styles.card} ${styles.selected}` : styles.card}
        aria-pressed={selected ?? undefined}
        aria-haspopup={popup}
        aria-expanded={expanded}
        onClick={onClick}
      >
        <span className={styles.picture}>
          <Face image={image} name={name} />
          {selected !== null && <span className={styles.check}>{selected && <Icon icon={Check} size="xs" />}</span>}
        </span>
        <span className={styles.name}>{name}</span>
        <span className={styles.note}>{note}</span>
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

function Face({ image, name }: { image: string | null; name: string }) {
  return image ? <img className={styles.image} src={image} alt="" /> : <span className={styles.letter}>{name.slice(0, 1)}</span>;
}

export function SelectionBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}
