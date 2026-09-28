import type { ReactNode } from 'react';
import { Screen } from '../layout/Screen';
import styles from './Empty.module.css';

type Props = {
  // Where it stands: a screen's or side panel's body, a section, the story, the pane beside a list with nothing picked
  // from it, the sidebar's list, or a menu.
  variant?: 'body' | 'section' | 'story' | 'pane' | 'side' | 'menu';
  children: ReactNode;
};

// What stands where a list, a grid, a pane or a panel has nothing to show, saying why or what to do.
export function Empty({ variant = 'body', children }: Props) {
  const text = <p className={variant === 'body' ? styles.empty : `${styles.empty} ${styles[variant]}`}>{children}</p>;
  return variant === 'pane' ? <Screen align="center">{text}</Screen> : text;
}
