import { useId, type ReactNode } from 'react';
import styles from './SettingGroup.module.css';

// Settings in one rounded box, a line between each.
export function SettingGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      {children}
    </div>
  );
}

type RowProps = {
  label: string;
  help?: ReactNode;
  // What sets it: a field, a menu, a button, or a fact in words. Beside the words where there is room, under them on phones.
  control: ReactNode;
  error?: string;
};

export function SettingRow({ label, help, control, error }: RowProps) {
  const id = useId();
  return (
    <div className={styles.row} role="group" aria-labelledby={id}>
      <div className={styles.words}>
        <span id={id} className={styles.label}>
          {label}
        </span>
        {help && <span className={styles.help}>{help}</span>}
      </div>
      <div className={styles.control}>{control}</div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
