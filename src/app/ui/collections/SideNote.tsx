import type { ReactNode } from 'react';
import styles from './SideNote.module.css';

// A line in the list where rows would be, such as an empty search.
export function SideNote({ children }: { children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}
