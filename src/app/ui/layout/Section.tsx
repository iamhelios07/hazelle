import type { ReactNode } from 'react';
import styles from './Section.module.css';

type Props = {
  title: string;
  // 2 on a screen, under its h1; 3 in a side panel, under the panel's title, where it reads smaller.
  level?: 2 | 3;
  // A short figure beside the title, such as a cache hit rate.
  note?: string;
  children: ReactNode;
};

export function Section({ title, level = 2, note, children }: Props) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section className={`${styles.section} ${styles[`level${level}`]}`}>
      <div className={styles.head}>
        <Heading className={styles.title}>{title}</Heading>
        {note && <span className={styles.note}>{note}</span>}
      </div>
      {children}
    </section>
  );
}
