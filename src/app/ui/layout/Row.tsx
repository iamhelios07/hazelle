import type { ReactNode } from 'react';
import styles from './Row.module.css';

export function Row({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}
