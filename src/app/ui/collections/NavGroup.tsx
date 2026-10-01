import type { ReactNode } from 'react';
import styles from './NavGroup.module.css';

// A set of places in the app, spaced apart from the next set, such as 설정's.
export function NavGroup({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}
