import type { ReactNode } from 'react';
import { AsideColumns } from './Screen';
import styles from './Beside.module.css';

type Props = {
  side: ReactNode;
  // after: a narrower column, under the body where both do not fit at their least widths.
  // preview: a preview of what the body changes, which stays in view as the body scrolls; above the body where narrow.
  variant?: 'after' | 'preview';
  children: ReactNode;
};

export function Beside({ side, variant = 'after', children }: Props) {
  if (variant === 'preview') {
    return (
      <AsideColumns aside={side} sticky>
        {children}
      </AsideColumns>
    );
  }
  return (
    <div className={styles.beside}>
      <div className={styles.main}>{children}</div>
      <div className={styles.side}>{side}</div>
    </div>
  );
}
