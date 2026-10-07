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
  ref?: Ref<HTMLButtonElement>;
  size?: 'xs' | 'sm' | 'md';
  disabled?: boolean;
  // Something behind it needs a look, such as a failure inside the menu it opens; the words are inside.
  dot?: boolean;
};

// label is required: an icon-only button has no other accessible name.
export function IconButton({ icon, label, title = label, onClick, pressed, popup, expanded, ref, size = 'md', disabled = false, dot = false }: Props) {
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
      {dot && <span className={styles.dot} aria-hidden />}
    </button>
  );
}
