import type { ReactNode } from 'react';
import styles from './FieldRow.module.css';

// name and value: fields without a shown label; their placeholders name them.
export function FieldRow({ name, value, action }: { name: ReactNode; value: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.row}>
      {name}
      {value}
      {action}
    </div>
  );
}
