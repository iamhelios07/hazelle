import type { ReactNode } from 'react';
import { ButtonSlot } from '../controls/Button';
import { Screen } from '../layout/Screen';
import styles from './Empty.module.css';

type Props = {
  variant?: 'body' | 'section' | 'story' | 'pane' | 'side' | 'menu';
  // The first step out of empty, such as 새 연결 on a list of one's own things.
  action?: ReactNode;
  children: ReactNode;
};

export function Empty({ variant = 'body', action, children }: Props) {
  const line = <p className={variant === 'body' ? styles.empty : `${styles.empty} ${styles[variant]}`}>{children}</p>;
  const text = action ? (
    <div className={styles.withAction}>
      {line}
      <ButtonSlot value="sm">{action}</ButtonSlot>
    </div>
  ) : (
    line
  );
  return variant === 'pane' ? <Screen align="center">{text}</Screen> : text;
}
