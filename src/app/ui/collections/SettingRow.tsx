import type { ReactNode } from 'react';
import styles from './SettingRow.module.css';

type Props = {
  label: string;
  // changed: the value differs from its default, marked by a dot and told in note, such as "처음 값: 끔".
  changed: boolean;
  note?: string;
  // The Switch or ChoiceGroup that sets it, which carries the label for screen readers.
  control: ReactNode;
};

// One setting in a side panel's list, such as a chat's toggle.
export function SettingRow({ label, changed, note, control }: Props) {
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span className={styles.label}>
          {changed && <span className={styles.dot} aria-hidden />}
          {label}
        </span>
        {note && <span className={styles.note}>{note}</span>}
      </span>
      {control}
    </div>
  );
}
