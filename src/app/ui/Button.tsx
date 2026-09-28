import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Button.module.css';
import { Icon } from './Icon';

type Props = {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
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
