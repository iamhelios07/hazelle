import type { Ref } from 'react';
import styles from './TitleField.module.css';

type Props = {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
};

export function TitleField({ label, value, placeholder, onChange, ref }: Props) {
  return (
    <input
      ref={ref}
      className={styles.field}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
