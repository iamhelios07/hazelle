import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Item.module.css';

type Props = {
  // chip: a rounded filter sized to its label. compact: one line of the sidebar or a menu. regular: a title over a
  // one-line preview, such as a chat in the sidebar. tall: a row of a screen's list.
  density: 'chip' | 'compact' | 'regular' | 'tall';
  // The sidebar's, a list's or menu's, and a filter tab's colours.
  scheme: 'side' | 'list' | 'tab';
  leading?: ReactNode;
  title: ReactNode;
  // Beside the title, such as a time or a count; under it in a tall row, such as a model id and tags.
  meta?: ReactNode;
  // Under the title, such as a chat's last words.
  preview?: ReactNode;
  trailing?: ReactNode;
  // 'page': the item open beside its list (ListDetail).
  current?: boolean | 'page';
  // One of a set of choices, pressed while it is the chosen one.
  pressed?: boolean;
  // A branch of a tree, open or closed; the rows under it are its caller's.
  expanded?: boolean;
  role?: 'menuitem' | 'menuitemradio';
  checked?: boolean;
  tone?: 'default' | 'muted' | 'warn';
  // With onClick the whole row is one button, so trailing must not hold a control then.
  onClick?: () => void;
};

// Every row that is picked from a list: the sidebar's, a menu's, a screen's list and a row of filter tabs. The fill
// under the pointer and on the current row follows aria-current and aria-pressed, so it cannot disagree with what a
// screen reader is told.
export function Item({ density, scheme, leading, title, meta, preview, trailing, current, pressed, expanded, role, checked, tone = 'default', onClick }: Props) {
  const branch = expanded !== undefined;
  const classes = [styles.item, styles[density], styles[scheme], onClick && styles.pressable, branch && styles.branch, tone !== 'default' && styles[tone]].filter(Boolean).join(' ');
  // A regular row is always two lines, so its title and preview are cut short rather than wrapped.
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
    <button type="button" className={classes} role={role} aria-checked={checked} aria-current={current || undefined} aria-pressed={pressed} aria-expanded={expanded} onClick={onClick}>
      {content}
    </button>
  );
}
