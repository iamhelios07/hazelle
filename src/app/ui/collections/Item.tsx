import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Item.module.css';

type Props = {
  density: 'chip' | 'compact' | 'regular' | 'tall';
  scheme: 'side' | 'list' | 'tab';
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  preview?: ReactNode;
  trailing?: ReactNode;
  // 'page': the item open beside its list (ListDetail).
  current?: boolean | 'page';
  pressed?: boolean;
  expanded?: boolean;
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
  checked?: boolean;
  tone?: 'default' | 'muted' | 'warn';
  disabled?: boolean;
  // With onClick the whole row is one button, so trailing must not hold a control then.
  onClick?: () => void;
};

// The fill under the pointer and on the current row follows aria-current and aria-pressed, so it cannot disagree with
// what a screen reader is told.
export function Item({ density, scheme, leading, title, meta, preview, trailing, current, pressed, expanded, role, checked, tone = 'default', disabled, onClick }: Props) {
  const branch = expanded !== undefined;
  const line = density === 'tall' && meta === undefined && preview === undefined;
  const classes = [styles.item, styles[density], styles[scheme], line && styles.line, onClick && styles.pressable, branch && styles.branch, tone !== 'default' && styles[tone]].filter(Boolean).join(' ');
  const clip = density === 'regular';
  // meta and preview are drawn even when empty: an empty time still keeps its gap beside the title.
  const content = (
    <>
      {branch ? <Icon icon={expanded ? ChevronDown : ChevronRight} size="xs" /> : leading}
      <span className={styles.text}>
        <span className={styles.head}>
          <span className={clip ? `${styles.title} ${styles.clip}` : styles.title}>{title}</span>
          {meta !== undefined && <span className={styles.meta}>{meta}</span>}
        </span>
        {preview !== undefined && <span className={clip ? `${styles.preview} ${styles.clip}` : styles.preview}>{preview}</span>}
      </span>
      {trailing}
    </>
  );
  if (!onClick) return <div className={classes}>{content}</div>;
  return (
    <button type="button" className={classes} role={role} aria-checked={checked} aria-current={current || undefined} aria-pressed={pressed} aria-expanded={expanded} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  );
}
