import type { LucideIcon } from 'lucide-react';
import styles from './IconButton.module.css';
import { Icon } from './Icon';

// label is required: an icon-only button has no other accessible name.
export function IconButton({ icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.button} aria-label={label} title={label} onClick={onClick}>
      <Icon icon={icon} />
    </button>
  );
}
