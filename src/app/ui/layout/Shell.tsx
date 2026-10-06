import type { ReactNode } from 'react';
import styles from './Shell.module.css';

// start: every screen begins at one top-left corner, so pages of different widths do not move it as the sidebar is walked.
export function Shell({ side, align = 'center', children }: { side: ReactNode; align?: 'center' | 'start'; children: ReactNode }) {
  return (
    <div className={styles.shell}>
      {side}
      <div className={align === 'start' ? `${styles.main} ${styles.start}` : styles.main}>{children}</div>
    </div>
  );
}
