import { Check, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Popover.module.css';

type Props = {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  // Which corner of the trigger it opens from, and which way.
  place?: 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'beside';
  size?: 'md' | 'lg';
  label: string;
  role?: 'menu' | 'dialog';
  children: ReactNode;
};

// Every menu and small panel that opens from a button. A press outside it or Esc closes it, and Esc
// gives the focus back to its button.
export function Popover({ open, onClose, trigger, place = 'below-start', size = 'md', label, role = 'menu', children }: Props) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('input, [role^="menuitem"], button')?.focus();
    const press = (event: PointerEvent) => anchor.current?.contains(event.target as Node) || close.current();
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close.current();
      anchor.current?.querySelector<HTMLElement>('button')?.focus();
    };
    document.addEventListener('pointerdown', press);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  // A panel that would cross the screen's side moves back inside it, whichever corner it opens from,
  // before it is painted.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    const edge = parseFloat(getComputedStyle(element).getPropertyValue('--popover-edge'));
    const room = document.documentElement.clientWidth;
    const shift = box.left < edge ? edge - box.left : box.right > room - edge ? room - edge - box.right : 0;
    element.style.setProperty('--nudge', `${shift}px`);
  }, [open]);

  return (
    <div className={styles.anchor} ref={anchor}>
      {trigger}
      {open && (
        <div ref={panel} className={`${styles.popover} ${styles[place]} ${styles[size]}`} role={role} aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

type ItemProps = {
  label: string;
  sub?: string;
  hint?: string;
  icon?: LucideIcon;
  // Makes the item one of a set of choices, checked when it is the current one.
  checked?: boolean;
  tone?: 'default' | 'muted' | 'warn';
  disabled?: boolean;
  onClick: () => void;
};

export function MenuItem({ label, sub, hint, icon, checked, tone = 'default', disabled = false, onClick }: ItemProps) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={tone === 'default' ? styles.item : `${styles.item} ${styles[tone]}`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <Icon icon={icon} size="xs" />}
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {sub && <span className={styles.sub}>{sub}</span>}
      </span>
      {hint && <span className={styles.hint}>{hint}</span>}
      {checked && (
        <span className={styles.check}>
          <Icon icon={Check} size="xs" />
        </span>
      )}
    </button>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <span className={styles.heading}>{children}</span>;
}

// A line of text inside a menu, such as an empty search.
export function MenuNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}
