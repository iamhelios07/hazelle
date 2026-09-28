import type { LucideIcon } from 'lucide-react';
import type { Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './IconButton.module.css';

type Props = {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  // A button that opens a menu takes popup, expanded and ref from Menu; one that shows and hides a panel takes
  // expanded alone.
  popup?: 'menu';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  size?: 'sm' | 'md';
  disabled?: boolean;
};

// label is required: an icon-only button has no other accessible name. pressed makes it a toggle,
// such as a star, drawn filled in the accent color while on.
export function IconButton({ icon, label, onClick, pressed, popup, expanded, ref, size = 'md', disabled = false }: Props) {
  return (
    <button
      ref={ref}
      type="button"
      className={size === 'sm' ? `${styles.button} ${styles.sm}` : styles.button}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-haspopup={popup}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={icon} size={size} />
    </button>
  );
}
