import type { ReactNode } from 'react';
import styles from './Shell.module.css';

// The app frame on wide screens: the sidebar (or its rail) beside the page. Phones get no side, and
// their home screen is the sidebar itself.
export function Shell({ side, children }: { side: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {side}
      <div className={styles.main}>{children}</div>
    </div>
  );
}
