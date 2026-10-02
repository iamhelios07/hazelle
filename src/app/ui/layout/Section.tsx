import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Hint } from '../overlays/Hint';
import styles from './Section.module.css';

type Props = {
  title: string;
  // 2 on a screen, under its h1; 3 in a side panel, under the panel's title, where it reads smaller.
  level?: 2 | 3;
  // A short figure beside the title, such as a cache hit rate.
  note?: string;
  // What the reader who does not know it needs, behind an ⓘ after the title.
  hint?: string;
  // A small button at the end of the title's line, such as 순서 바꾸기.
  action?: ReactNode;
  // The view goes to it when it mounts with seek, or when seek turns on.
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
