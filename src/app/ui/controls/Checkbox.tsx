import a11y from '../foundation/a11y.module.css';
import styles from './Checkbox.module.css';

type Props = {
  label: string;
  // Read aloud only, where the row beside it already names what it ticks.
  hideLabel?: boolean;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

export function Checkbox({ label, hideLabel = false, note, checked, disabled = false, onChange }: Props) {
  return (
    <label className={disabled ? `${styles.checkbox} ${styles.disabled}` : styles.checkbox}>
      <input className={styles.input} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {hideLabel ? <span className={a11y.srOnly}>{label}</span> : label}
      {note && <span className={styles.note}>{note}</span>}
    </label>
  );
}
