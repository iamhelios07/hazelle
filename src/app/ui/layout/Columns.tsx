import type { ReactNode } from 'react';
import styles from './Columns.module.css';

// As many equal columns as fit, each no narrower than its kind: tile (a pick card), wide (a row-like card), panel (a
// card of settings). One column on a narrow page.
export function Columns({ min = 'tile', children }: { min?: 'tile' | 'wide' | 'panel'; children: ReactNode }) {
  return <div className={`${styles.columns} ${styles[min]}`}>{children}</div>;
}
