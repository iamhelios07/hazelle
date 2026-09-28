import { Search } from 'lucide-react';
import { useId } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './SearchField.module.css';

// The label is read by screen readers only; the icon and placeholder say it on screen. An API key
// may be pasted here, so the browser keeps no history of what was typed.
type Props = { label: string; value: string; onChange: (value: string) => void; size?: 'sm' | 'md' };

export function SearchField({ label, value, onChange, size = 'md' }: Props) {
  const id = useId();
  return (
    <div className={size === 'sm' ? `${styles.field} ${styles.sm}` : styles.field}>
      <Icon icon={Search} size={size === 'sm' ? 'xs' : 'md'} />
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
