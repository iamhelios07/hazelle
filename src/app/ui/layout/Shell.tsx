import type { ReactNode } from 'react';
import styles from './Shell.module.css';

export function Shell({ side, children }: { side: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {side}
      <div className={styles.main}>{children}</div>
    </div>
  );
}
