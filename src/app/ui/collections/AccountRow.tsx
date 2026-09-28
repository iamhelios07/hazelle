import type { ReactNode } from 'react';
import styles from './AccountRow.module.css';

// Who is signed in, with their controls.
export function AccountRow({ avatar, name, children }: { avatar: ReactNode; name: string; children: ReactNode }) {
  return (
    <div className={styles.account}>
      {avatar}
      <span className={styles.name}>{name}</span>
      {children}
    </div>
  );
}
