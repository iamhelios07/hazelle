import type { ReactNode } from 'react';
import styles from './Thread.module.css';

// Comments under a post, each with its 답글 one step in.
export function Thread({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.thread} aria-label={label}>
      {children}
    </ul>
  );
}

type Props = {
  byline: ReactNode;
  // A MoreMenu at the head's end.
  control?: ReactNode;
  // What it says, set in under the name.
  children: ReactNode;
  // Under what it says, such as 답글.
  foot?: ReactNode;
  // ThreadItems answering it, a step in along a line.
  replies?: ReactNode;
};

export function ThreadItem({ byline, control, children, foot, replies }: Props) {
  return (
    <li className={styles.item}>
      <div className={styles.head}>
        {byline}
        {control && <span className={styles.control}>{control}</span>}
      </div>
      <div className={styles.body}>
        {children}
        {foot && <div className={styles.foot}>{foot}</div>}
      </div>
      {replies && <ul className={styles.replies}>{replies}</ul>}
    </li>
  );
}
