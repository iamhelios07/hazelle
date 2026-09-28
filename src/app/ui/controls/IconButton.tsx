import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './IconButton.module.css';

type Props = {
  icon: LucideIcon;
  label: string;
  // The tooltip, when it says more than the label, such as the keys that press it.
  title?: string;
  onClick: () => void;
  pressed?: boolean;
  // For a button that opens a popover.
  expanded?: boolean;
  // xs: a message's tools and version switcher.
  size?: 'xs' | 'sm' | 'md';
  disabled?: boolean;
};

// label is required: an icon-only button has no other accessible name. pressed makes it a toggle,
// such as a star, drawn filled in the accent color while on.
export function IconButton({ icon, label, title = label, onClick, pressed, expanded, size = 'md', disabled = false }: Props) {
  return (
    <button
      type="button"
      className={size === 'md' ? styles.button : `${styles.button} ${styles[size]}`}
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon icon={icon} size={size} />
    </button>
  );
}
