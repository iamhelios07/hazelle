import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './IconButton.module.css';

type Props = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  // For a button that opens a popover.
  expanded?: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
};

// label is required: an icon-only button has no other accessible name. pressed makes it a toggle,
// such as a star, drawn filled in the accent color while on.
export function IconButton({ icon, label, onClick, pressed, expanded, size = 'md', disabled = false }: Props) {
  return (
    <button
      type="button"
      className={size === 'sm' ? `${styles.button} ${styles.sm}` : styles.button}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={icon} size={size} />
    </button>
  );
}
