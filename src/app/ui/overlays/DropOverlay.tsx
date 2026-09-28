import type { ReactNode } from 'react';
import { Import } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './DropOverlay.module.css';

// Shown over the whole app while files are dragged over it.
export function DropOverlay({ children }: { children: ReactNode }) {
  return (
    <div className={styles.overlay} aria-hidden>
      <div className={styles.target}>
        <Icon icon={Import} />
        {children}
      </div>
    </div>
  );
}
