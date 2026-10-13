import type { ReactNode } from 'react';
import styles from './Beside.module.css';

// A main column with a narrower one beside it where both fit, under it where they do not.
export function Beside({ side, children }: { side: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.beside}>
      <div className={styles.main}>{children}</div>
      <div className={styles.side}>{side}</div>
    </div>
  );
}
