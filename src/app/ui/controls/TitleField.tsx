import type { Ref } from 'react';
import styles from './TitleField.module.css';

type Props = {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  size?: 'md' | 'lg';
  ref?: Ref<HTMLInputElement>;
};

export function TitleField({ label, value, placeholder, onChange, size = 'lg', ref }: Props) {
  return (
    <input
      ref={ref}
      className={`${styles.field} ${styles[size]}`}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
