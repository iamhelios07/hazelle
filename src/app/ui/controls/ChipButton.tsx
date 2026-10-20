import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './ChipButton.module.css';

type Props = {
  label: string;
  title: string;
  leading?: ReactNode;
  variant?: 'chip' | 'field' | 'ghost' | 'value';
  opens?: 'down' | 'up';
  // warn: the current choice is missing.
  tone?: 'plain' | 'warn';
  phone?: 'full' | 'icon';
  popup: 'menu' | 'dialog';
  expanded: boolean;
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
};

export function ChipButton({ label, title, leading, variant = 'chip', opens = 'down', tone = 'plain', phone = 'full', popup, expanded, ref, onClick }: Props) {
  const classes = [styles.chip, variant !== 'chip' && styles[variant], tone === 'warn' && styles.warn, phone === 'icon' && styles.phoneIcon].filter(Boolean).join(' ');
  return (
    <button ref={ref} type="button" className={classes} title={title} aria-label={`${title} · ${label}`} aria-haspopup={popup} aria-expanded={expanded} onClick={onClick}>
      {leading}
      <span className={styles.label}>{label}</span>
      <Icon icon={opens === 'down' ? ChevronDown : ChevronUp} size="xs" />
    </button>
  );
}
