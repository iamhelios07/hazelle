import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './ChipButton.module.css';

type Props = {
  label: string;
  title: string;
  // An icon or a face before the label, such as a prompt's page or a persona's face.
  leading?: ReactNode;
  // field: shaped like a form's field, for a setting's choice, such as 기본값's default prompt. ghost: borderless, in
  // the composer's bar.
  variant?: 'chip' | 'field' | 'ghost';
  // The way its menu opens, which the chevron points.
  opens?: 'down' | 'up';
  // warn: the current choice is missing.
  tone?: 'default' | 'warn';
  // icon: on a phone only the leading icon shows, so the header keeps room for the chat's title.
  phone?: 'full' | 'icon';
  popup: 'menu' | 'dialog';
  expanded: boolean;
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
};

// A rounded button that opens a menu and names its current choice, such as the chat's model.
export function ChipButton({ label, title, leading, variant = 'chip', opens = 'down', tone = 'default', phone = 'full', popup, expanded, ref, onClick }: Props) {
  const classes = [styles.chip, variant !== 'chip' && styles[variant], tone === 'warn' && styles.warn, phone === 'icon' && styles.phoneIcon].filter(Boolean).join(' ');
  return (
    <button ref={ref} type="button" className={classes} title={title} aria-label={`${title} · ${label}`} aria-haspopup={popup} aria-expanded={expanded} onClick={onClick}>
      {leading}
      <span className={styles.label}>{label}</span>
      <Icon icon={opens === 'down' ? ChevronDown : ChevronUp} size="xs" />
    </button>
  );
}
