import type { ReactNode } from 'react';
import { Screen } from '../layout/Screen';
import styles from './Empty.module.css';

type Props = {
  variant?: 'body' | 'section' | 'story' | 'pane' | 'side' | 'menu';
  children: ReactNode;
};

// What stands where a list, a grid, a pane or a panel has nothing to show, in the look of where it stands.
export function Empty({ variant = 'body', children }: Props) {
  const text = <p className={variant === 'body' ? styles.empty : `${styles.empty} ${styles[variant]}`}>{children}</p>;
  return variant === 'pane' ? <Screen align="center">{text}</Screen> : text;
}
