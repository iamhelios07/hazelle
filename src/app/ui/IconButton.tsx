import type { LucideIcon } from 'lucide-react';
import styles from './IconButton.module.css';
import { Icon } from './Icon';

type Props = { icon: LucideIcon; label: string; onClick: () => void; pressed?: boolean };

// label is required: an icon-only button has no other accessible name. pressed makes it a toggle,
// such as a star, drawn filled in the accent color while on.
export function IconButton({ icon, label, onClick, pressed }: Props) {
  return (
    <button type="button" className={styles.button} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      <Icon icon={icon} />
    </button>
  );
}
