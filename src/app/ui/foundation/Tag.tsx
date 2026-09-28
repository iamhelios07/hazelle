import type { ReactNode } from 'react';
import styles from './Tag.module.css';

// accent: a gold mark such as 기본.
export function Tag({ tone = 'default', children }: { tone?: 'default' | 'accent'; children: ReactNode }) {
  return <span className={tone === 'accent' ? `${styles.tag} ${styles.accent}` : styles.tag}>{children}</span>;
}
