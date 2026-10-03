import { ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Disclosure.module.css';

// What is folded is made only while open, so a long list of them stays light.
export function Disclosure({ label, startOpen = false, children }: { label: string; startOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  const id = useId();
  return (
    <div className={styles.disclosure}>
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className={styles.chevron}>
          <Icon icon={ChevronRight} size="xs" />
        </span>
        {label}
      </button>
      <div id={id} className={styles.body} hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}
