import type { Ref } from 'react';
import styles from './TitleField.module.css';

type Props = {
  label: string;
  value: string;
  // Stands in while the value is empty, in the title's own tone, such as a slot's name.
  placeholder: string;
  onChange: (value: string) => void;
  // lg: a page's title. md: a screen's top row.
  size?: 'md' | 'lg';
  ref?: Ref<HTMLInputElement>;
};

// A title that is also the field that renames it: it reads as the title until pointed at.
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
