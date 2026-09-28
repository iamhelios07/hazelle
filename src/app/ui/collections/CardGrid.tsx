import { Check } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './CardGrid.module.css';

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
  // A card that opens a menu takes these from Menu.
  popup?: 'menu';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  // A menu button over the picture's corner, beside the card rather than inside its button.
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
          {image ? <img className={styles.image} src={image} alt="" /> : <span className={styles.letter}>{name.slice(0, 1)}</span>}
          {selected !== null && <span className={styles.check}>{selected && <Icon icon={Check} size="xs" />}</span>}
        </span>
        <span className={styles.name}>{name}</span>
        <span className={styles.note}>{note}</span>
      </button>
      {menu && <div className={styles.menu}>{menu}</div>}
    </div>
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
