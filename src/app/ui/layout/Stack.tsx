import type { ReactNode } from 'react';
import styles from './Stack.module.css';

export function Stack({ gap = 'group', children }: { gap?: 'related' | 'group' | 'section'; children: ReactNode }) {
  return <div className={`${styles.stack} ${styles[gap]}`}>{children}</div>;
}
