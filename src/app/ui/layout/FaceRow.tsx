import type { ReactNode } from 'react';
import styles from './FaceRow.module.css';

export function FaceRow({ face, children }: { face: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.row}>
      {face}
      <div className={styles.lines}>{children}</div>
    </div>
  );
}
