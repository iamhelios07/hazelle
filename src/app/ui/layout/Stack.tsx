import type { ReactNode } from 'react';
import styles from './Stack.module.css';

// related: parts of one thing, such as a search box and its filters. group: the items of one part of a
// screen, such as a form's fields. section: a screen's parts, as Screen already spaces its own children.
export function Stack({ gap = 'group', children }: { gap?: 'related' | 'group' | 'section'; children: ReactNode }) {
  return <div className={`${styles.stack} ${styles[gap]}`}>{children}</div>;
}
