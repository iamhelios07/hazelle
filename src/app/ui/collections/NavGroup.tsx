import type { ReactNode } from 'react';
import styles from './NavGroup.module.css';

export function NavGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      {title && <h3 className={styles.title}>{title}</h3>}
      {children}
    </div>
  );
}
