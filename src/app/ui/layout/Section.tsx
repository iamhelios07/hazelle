import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Hint } from '../overlays/Hint';
import styles from './Section.module.css';

type Props = {
  title: string;
  level?: 2 | 3;
  note?: string;
  hint?: string;
  action?: ReactNode;
  seek?: boolean;
  children: ReactNode;
};

export function Section({ title, level = 2, note, hint, action, seek = false, children }: Props) {
  const self = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (seek) self.current?.scrollIntoView({ block: 'start' });
  }, [seek]);
  const Heading = level === 2 ? 'h2' : 'h3';
  const noted = note && <span className={styles.note}>{note}</span>;
  return (
    <section ref={self} className={`${styles.section} ${styles[`level${level}`]}`}>
      <div className={styles.head}>
        <span className={styles.name}>
          <Heading className={styles.title}>{title}</Heading>
          {hint && <Hint label={title}>{hint}</Hint>}
        </span>
        {action ? (
          <span className={styles.end}>
            {noted}
            {action}
          </span>
        ) : (
          noted
        )}
      </div>
      {children}
    </section>
  );
}
