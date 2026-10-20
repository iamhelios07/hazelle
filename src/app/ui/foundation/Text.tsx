import type { ReactNode } from 'react';
import styles from './Text.module.css';

// written: what someone wrote for others to read, such as a post or a comment, its line breaks kept.
type Props = { variant?: 'body' | 'note' | 'prose' | 'written'; align?: 'start' | 'center'; children: ReactNode };

export function Text({ variant = 'body', align = 'start', children }: Props) {
  return <p className={align === 'center' ? `${styles[variant]} ${styles.center}` : styles[variant]}>{children}</p>;
}
