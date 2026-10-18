import { ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Disclosure.module.css';

// What is folded is made only while open, so a long list of them stays light.
// menu: a ⋯ at the end of the line, such as an editor's for a toggle group.
export function Disclosure({ label, menu, children }: { label: string; menu?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
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
