import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ButtonSlot } from '../controls/Button';
import { Hint } from '../overlays/Hint';
import styles from './Panel.module.css';

type Props = {
  title?: string;
  level?: 2 | 3;
  help?: string;
  // By the title: a button (sm) or a control that acts on the whole card, such as its Switch.
  action?: ReactNode;
  seek?: boolean;
  children: ReactNode;
};

// A card of its own on a page, where a Section's rows would leave the width empty: a setting's group, a status.
export function Panel({ title, level = 2, help, action, seek = false, children }: Props) {
  const self = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (seek) self.current?.scrollIntoView({ block: 'start' });
  }, [seek]);
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section ref={self} className={styles.panel} aria-label={title}>
      {title && (
        <div className={styles.head}>
          <span className={styles.name}>
            <Heading className={styles.title}>{title}</Heading>
            {help && <Hint label={title}>{help}</Hint>}
          </span>
          {action && <ButtonSlot value="sm">{action}</ButtonSlot>}
        </div>
      )}
      {children}
    </section>
  );
}
