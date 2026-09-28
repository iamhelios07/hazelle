import type { ReactNode } from 'react';
import styles from './Row.module.css';

// toolbar: controls over what follows, such as search and sort. actions: what can be done with the thing
// shown. tags: small labels. spread: the first item takes the room left, such as a status before its buttons.
export function Row({ kind, children }: { kind: 'toolbar' | 'actions' | 'tags' | 'spread'; children: ReactNode }) {
  return <div className={`${styles.row} ${styles[kind]}`}>{children}</div>;
}
