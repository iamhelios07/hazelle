import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ButtonSlot } from '../controls/Button';
import { Hint } from '../overlays/Hint';
import styles from './Section.module.css';

type Props = {
  title: string;
  level?: 2 | 3;
  note?: string;
  help?: string;
  action?: ReactNode;
  seek?: boolean;
  // A Panel's, whose card may stand beside another's.
  boxed?: boolean;
  children: ReactNode;
};

export function Section({ title, level = 2, note, help, action, seek = false, boxed = false, children }: Props) {
  const self = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (seek) self.current?.scrollIntoView({ block: 'start' });
  }, [seek]);
  const Heading = level === 2 ? 'h2' : 'h3';
  const noted = note && <span className={styles.note}>{note}</span>;
  return (
    <section ref={self} className={[styles.section, styles[`level${level}`], boxed && styles.boxed].filter(Boolean).join(' ')}>
      <div className={styles.head}>
        <span className={styles.name}>
          <Heading className={styles.title}>{title}</Heading>
          {help && <Hint label={title}>{help}</Hint>}
        </span>
        {action ? (
          <span className={styles.end}>
            {noted}
            <ButtonSlot value="sm">{action}</ButtonSlot>
          </span>
        ) : (
          noted
        )}
      </div>
      {children}
    </section>
  );
}
