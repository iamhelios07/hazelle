import type { LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Button.module.css';

type Props = {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link';
  // xs: a link inside a line of small text.
  size?: 'xs' | 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  icon?: LucideIcon;
  busy?: boolean;
  disabled?: boolean;
  // A button that opens a menu takes these from Menu.
  popup?: 'menu';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  onClick?: () => void;
  children: ReactNode;
};

export function Button({ variant = 'primary', size = 'lg', type = 'button', icon, busy = false, disabled = false, popup, expanded, ref, onClick, children }: Props) {
  const classes = [styles.button, styles[variant], styles[size], busy && styles.busy].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      className={classes}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-haspopup={popup}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {icon && <Icon icon={icon} />}
      <span className={styles.label}>{children}</span>
      {busy && <span className={styles.spinner} aria-hidden />}
    </button>
  );
}
