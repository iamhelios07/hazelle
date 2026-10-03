import type { ReactNode } from 'react';
import styles from './NavGroup.module.css';

export function NavGroup({ children }: { children: ReactNode }) {
  return <div className={styles.group}>{children}</div>;
}
