import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
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
  onClick?: () => void;
  children: ReactNode;
};

export function Button({ variant = 'primary', size = 'lg', type = 'button', icon, busy = false, disabled = false, onClick, children }: Props) {
  const classes = [styles.button, styles[variant], styles[size], busy && styles.busy].filter(Boolean).join(' ');
  return (
    <button className={classes} type={type} disabled={disabled || busy} aria-busy={busy || undefined} onClick={onClick}>
      {icon && <Icon icon={icon} />}
      <span className={styles.label}>{children}</span>
      {busy && <span className={styles.spinner} aria-hidden />}
    </button>
  );
}
