import type { ReactNode } from 'react';
import styles from './Columns.module.css';

export function Columns({ children }: { children: ReactNode }) {
  return <div className={styles.columns}>{children}</div>;
}
