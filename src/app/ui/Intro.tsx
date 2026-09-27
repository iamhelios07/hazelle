import type { ReactNode } from 'react';
import styles from './Intro.module.css';

export function Intro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={styles.intro}>
      <h1 className={styles.title}>{title}</h1>
      {children && <p className={styles.lead}>{children}</p>}
    </div>
  );
}
