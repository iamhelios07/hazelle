import type { Ref } from 'react';
import styles from './TitleField.module.css';

type Props = {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  // Fits a one-line head with a subtitle under it.
  compact?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function TitleField({ label, value, placeholder, onChange, compact = false, ref }: Props) {
  return (
    <input
      ref={ref}
      className={compact ? `${styles.field} ${styles.compact}` : styles.field}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
