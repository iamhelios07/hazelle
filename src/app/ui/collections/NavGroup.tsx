import type { ReactNode } from 'react';
import styles from './NavGroup.module.css';

// A titled group stands in its own box under its title; an untitled one is a plain run of rows. head: what the places
// belong to, over them in the box, such as the board's nickname.
export function NavGroup({ title, head, children }: { title?: string; head?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.group}>
      {title === undefined ? (
        children
      ) : (
        <>
          <h3 className={styles.title}>{title}</h3>
          <div className={styles.box}>
            {head && <div className={styles.head}>{head}</div>}
            {children}
          </div>
        </>
      )}
    </div>
  );
}
