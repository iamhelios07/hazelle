import type { ReactNode } from 'react';
import styles from './Stack.module.css';

export function Stack({ gap = 16, children }: { gap?: 8 | 12 | 16 | 24; children: ReactNode }) {
  return <div className={`${styles.stack} ${styles[`gap${gap}`]}`}>{children}</div>;
}
