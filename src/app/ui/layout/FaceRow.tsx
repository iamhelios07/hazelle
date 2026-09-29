import type { ReactNode } from 'react';
import styles from './FaceRow.module.css';

// A face beside the lines that go with it, such as the signed-in account's name or a persona's picture controls.
// The lines sit close together and centre on the face as one block.
export function FaceRow({ face, children }: { face: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.row}>
      {face}
      <div className={styles.lines}>{children}</div>
    </div>
  );
}
