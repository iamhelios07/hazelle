import type { LucideIcon } from 'lucide-react';
import type { Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './IconButton.module.css';

type Props = {
  icon: LucideIcon | string;
  label: string;
  title?: string;
  onClick: () => void;
  pressed?: boolean;
  // A button that opens a menu takes popup, expanded and ref from Menu; one that shows and hides a panel takes
  // expanded alone.
  popup?: 'menu' | 'dialog';
  expanded?: boolean;
  // The id of what it holds open elsewhere, such as a SidePeek's drawer.
  controls?: string;
  ref?: Ref<HTMLButtonElement>;
  size?: 'xs' | 'sm' | 'md';
  disabled?: boolean;
};

// label is required: an icon-only button has no other accessible name.
export function IconButton({ icon, label, title = label, onClick, pressed, popup, expanded, controls, ref, size = 'md', disabled = false }: Props) {
  return (
    <button
      ref={ref}
      type="button"
      className={size === 'md' ? styles.button : `${styles.button} ${styles[size]}`}
      aria-label={label}
      title={title}
      aria-pressed={pressed}
      aria-haspopup={popup}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      onClick={onClick}
    >
      {typeof icon === 'string' ? (
        <span className={styles.glyph} aria-hidden>
          {icon}
        </span>
      ) : (
        <Icon icon={icon} size={size} />
      )}
    </button>
  );
}
