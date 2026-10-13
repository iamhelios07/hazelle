import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './PickCard.module.css';

type Props = {
  label: string;
  value: string;
  note?: string;
  // warn: the value names something missing.
  tone?: 'default' | 'warn';
  // A menu's opener (from Menu's trigger), or none for a card that opens a place.
  popup?: 'menu';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
};

// A choice that leads its page, as a card: what it is, what is chosen and where that comes from.
export function PickCard({ label, value, note, tone = 'default', popup, expanded, ref, onClick }: Props) {
  return (
    <button ref={ref} type="button" className={styles.card} aria-label={`${label} · ${value}`} aria-haspopup={popup} aria-expanded={popup ? expanded : undefined} onClick={onClick}>
      <span className={styles.label}>{label}</span>
      <span className={styles.line}>
        <span className={tone === 'warn' ? `${styles.value} ${styles.warn}` : styles.value}>{value}</span>
        <Icon icon={popup ? ChevronDown : ChevronRight} size="xs" />
      </span>
      {note && <span className={styles.note}>{note}</span>}
    </button>
  );
}
