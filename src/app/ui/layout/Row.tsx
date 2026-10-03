import type { ReactNode } from 'react';
import styles from './Row.module.css';

export function Row({ kind, children }: { kind: 'toolbar' | 'actions' | 'tags' | 'spread'; children: ReactNode }) {
  return <div className={`${styles.row} ${styles[kind]}`}>{children}</div>;
}
