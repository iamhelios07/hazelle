import type { ReactNode } from 'react';
import styles from './Beside.module.css';

type Props = {
  side: ReactNode;
  // after: a narrower column, under the body where both do not fit at their least widths.
  // preview: a preview of what the body changes, which stays in view as the body scrolls; above the body where narrow.
  variant?: 'after' | 'preview';
  children: ReactNode;
};

export function Beside({ side, variant = 'after', children }: Props) {
  const body = <div className={styles.main}>{children}</div>;
  const column = <div className={styles.side}>{side}</div>;
  return variant === 'preview' ? (
    <div className={`${styles.beside} ${styles.preview}`}>
      {column}
      {body}
    </div>
  ) : (
    <div className={styles.beside}>
      {body}
      {column}
    </div>
  );
}
