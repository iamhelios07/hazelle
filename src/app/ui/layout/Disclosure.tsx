import { ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Grouped } from '../collections/SettingGroup';
import { Icon } from '../foundation/Icon';
import styles from './Disclosure.module.css';

type Held = { open: boolean; onOpen: (open: boolean) => void } | { open?: never; onOpen?: never };
type Props = { label: string; children: ReactNode } & Held &
  // A line of text, with a ⋯ or ⓘ at its end, or a row in a box of its own whose rows open under it, with what
  // is set among them at its end (세부 설정 · 2개 정함).
  ({ variant?: never; menu?: ReactNode; meta?: never } | { variant: 'row'; meta?: ReactNode; menu?: never });

// What is folded is made only while open, so a long list of them stays light.

export function Disclosure({ label, variant, meta, menu, open: held, onOpen, children }: Props) {
  const [own, setOwn] = useState(false);
  const open = held ?? own;
  const setOpen = onOpen ?? setOwn;
  const id = useId();
  if (variant === 'row')
    return (
      <div className={styles.box} role="group" aria-label={label}>
        <button type="button" className={`${styles.rowHead} ${styles.ruled}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className={styles.rowLabel}>{label}</span>
          {meta !== undefined && <span className={styles.meta}>{meta}</span>}
          <span className={styles.chevron}>
            <Icon icon={ChevronRight} size="sm" />
          </span>
        </button>
        <div id={id} className={`${styles.rows} ${styles.ruled}`} hidden={!open}>
          <Grouped value>{open && children}</Grouped>
        </div>
      </div>
    );
  return (
    <div className={styles.disclosure}>
      <div className={styles.head}>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className={styles.chevron}>
            <Icon icon={ChevronRight} size="xs" />
          </span>
          {label}
        </button>
        {menu}
      </div>
      <div id={id} className={styles.body} hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}
