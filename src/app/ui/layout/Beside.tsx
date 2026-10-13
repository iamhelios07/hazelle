import type { ReactNode } from 'react';
import styles from './Beside.module.css';

// The body and a narrower column beside it where both fit at their least widths; the side under the body where not.
export function Beside({ side, children }: { side: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.beside}>
      <div className={styles.main}>{children}</div>
      <div className={styles.side}>{side}</div>
    </div>
  );
}
