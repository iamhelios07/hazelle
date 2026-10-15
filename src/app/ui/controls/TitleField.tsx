import type { Ref } from 'react';
import styles from './TitleField.module.css';

type Props = {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  // The head it renames: a page's title, or a one-line head with a subtitle under it; else a title inside a pane.
  place?: 'page' | 'line';
  ref?: Ref<HTMLInputElement>;
};

export function TitleField({ label, value, placeholder, onChange, place, ref }: Props) {
  return (
    <input
      ref={ref}
      className={place ? `${styles.field} ${styles[place]}` : styles.field}
      aria-label={label}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
