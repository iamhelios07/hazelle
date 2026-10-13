import type { ReactNode } from 'react';
import styles from './PreviewSplit.module.css';

// Settings beside a preview of what they change, which stays in view as they scroll; where narrow, the preview above them.
export function PreviewSplit({ preview, children }: { preview: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.split}>
      <div className={styles.preview}>{preview}</div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}
