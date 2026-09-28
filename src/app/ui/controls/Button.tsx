import type { LucideIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Button.module.css';

type Props = {
  // danger: a way to delete what the page shows, such as 이 페르소나 지우기.
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'danger';
  // xs: a link inside a line of small text.
  size?: 'xs' | 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
  icon?: LucideIcon;
  // The name read out, when the text leans on the row around it; it must start with the text shown.
  label?: string;
  busy?: boolean;
  disabled?: boolean;
  // A button that opens a menu takes these from Menu.
  popup?: 'menu';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  onClick?: () => void;
  children: ReactNode;
};

export function Button({ variant = 'primary', size = 'lg', type = 'button', icon, label, busy = false, disabled = false, popup, expanded, ref, onClick, children }: Props) {
  const classes = [styles.button, styles[variant], styles[size], busy && styles.busy].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      className={classes}
      type={type}
      disabled={disabled || busy}
      aria-label={label}
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
