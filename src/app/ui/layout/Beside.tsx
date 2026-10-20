import type { ReactNode } from 'react';
import styles from './Beside.module.css';

// side: a narrower column, under the body where both do not fit at their least widths.
export function Beside({ side, children }: { side: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.beside}>
      <div className={styles.main}>{children}</div>
      <div className={styles.side}>{side}</div>
    </div>
  );
}
