import type { ReactNode } from 'react';
import styles from './NavGroup.module.css';

// A titled group stands in its own box under its title; an untitled one is a plain run of rows.
export function NavGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className={styles.group}>
      {title === undefined ? (
        children
      ) : (
        <>
          <h3 className={styles.title}>{title}</h3>
          <div className={styles.box}>{children}</div>
        </>
      )}
    </div>
  );
}
