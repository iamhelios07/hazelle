import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './SideRow.module.css';

type Props = { icon: LucideIcon; label: string; note?: string; current?: boolean; onClick: () => void };

// A place in the app, at the foot of the sidebar.
export function NavRow({ icon, label, note, current = false, onClick }: Props) {
  return (
    <button type="button" className={current ? `${styles.nav} ${styles.current}` : styles.nav} aria-current={current || undefined} onClick={onClick}>
      <Icon icon={icon} size="xs" />
      <span className={styles.label}>{label}</span>
      {note && <span className={styles.note}>{note}</span>}
    </button>
  );
}
