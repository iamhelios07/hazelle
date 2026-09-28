import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Gallery.module.css';
import { Icon } from './Icon';

// 캐릭터 둘러보기 (design F6): characters as large faces, since they are found by face more than by name.
export function CardGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.grid} role="group" aria-label={label}>
      {children}
    </div>
  );
}

type CardProps = {
  image: string | null;
  name: string;
  note: string;
  // null while the grid is not picking characters.
  selected: boolean | null;
  onClick: () => void;
};

export function FaceCard({ image, name, note, selected, onClick }: CardProps) {
  return (
    <button type="button" className={selected ? `${styles.card} ${styles.selected}` : styles.card} aria-pressed={selected ?? undefined} onClick={onClick}>
      <span className={styles.picture}>
        {image ? <img className={styles.image} src={image} alt="" /> : <span className={styles.letter}>{name.slice(0, 1)}</span>}
        {selected !== null && <span className={styles.check}>{selected && <Icon icon={Check} size="xs" />}</span>}
      </span>
      <span className={styles.name}>{name}</span>
      <span className={styles.note}>{note}</span>
    </button>
  );
}

// A character's own page: its face, large.
export function Portrait({ image, name }: { image: string | null; name: string }) {
  return <span className={styles.portrait}>{image ? <img className={styles.image} src={image} alt="" /> : <span className={styles.letter}>{name.slice(0, 1)}</span>}</span>;
}

// What to do with the picked characters, kept at the bottom of the screen while picking.
export function SelectionBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}
