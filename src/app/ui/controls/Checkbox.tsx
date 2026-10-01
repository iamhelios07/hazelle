import styles from './Checkbox.module.css';

type Props = {
  label: string;
  // A few words after the label, such as a count or why it cannot be ticked.
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

export function Checkbox({ label, note, checked, disabled = false, onChange }: Props) {
  return (
    <label className={disabled ? `${styles.checkbox} ${styles.disabled}` : styles.checkbox}>
      <input className={styles.input} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
      {note && <span className={styles.note}>{note}</span>}
    </label>
  );
}
