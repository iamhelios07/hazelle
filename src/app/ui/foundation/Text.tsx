import type { ReactNode } from 'react';
import styles from './Text.module.css';

// prose: long text read as written, its line breaks kept.
type Props = { variant?: 'body' | 'note' | 'highlight' | 'prose'; align?: 'start' | 'center'; children: ReactNode };

export function Text({ variant = 'body', align = 'start', children }: Props) {
  return <p className={align === 'center' ? `${styles[variant]} ${styles.center}` : styles[variant]}>{children}</p>;
}
