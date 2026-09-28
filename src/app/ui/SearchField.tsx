import { Search } from 'lucide-react';
import { useId } from 'react';
import { Icon } from './Icon';
import styles from './SearchField.module.css';

// The label is read by screen readers only; the icon and placeholder say it on screen. An API key
// may be pasted here, so the browser keeps no history of what was typed.
export function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <Icon icon={Search} />
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.input}
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
