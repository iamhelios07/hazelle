import type { ReactNode } from 'react';
import styles from './Tag.module.css';

// accent: marks the default among choices, such as 기본.
export function Tag({ tone = 'plain', children }: { tone?: 'plain' | 'accent'; children: ReactNode }) {
  return <span className={tone === 'plain' ? styles.tag : `${styles.tag} ${styles.accent}`}>{children}</span>;
}
