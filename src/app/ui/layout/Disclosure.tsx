import { ChevronRight } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Disclosure.module.css';

// A line that opens what is folded under it, such as the settings a model does not take.
export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
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
        {children}
      </div>
    </div>
  );
}
