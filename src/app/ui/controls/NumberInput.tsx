import styles from './NumberInput.module.css';

// placeholder: what an empty field stands for, such as 원래 값 where empty means unset. placeholderTone value: the
// placeholder is the number in effect, read as a value rather than a hint.
type Props = { label: string; value: string; onChange: (value: string) => void; invalid?: boolean; unit?: string; placeholder?: string; placeholderTone?: 'hint' | 'value' };

// A number typed as text: no spinner, and the scroll wheel never changes it. The caller reads and checks it.
export function NumberInput({ label, value, onChange, invalid = false, unit, placeholder, placeholderTone = 'hint' }: Props) {
  return (
    <span className={styles.box}>
      <input
        className={placeholderTone === 'value' ? `${styles.input} ${styles.value}` : styles.input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {unit && <span className={styles.unit}>{unit}</span>}
    </span>
  );
}
