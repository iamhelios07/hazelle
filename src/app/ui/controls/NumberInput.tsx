import styles from './NumberInput.module.css';

// placeholder: what an empty field stands for, such as 기본값 where empty means unset.
type Props = { label: string; value: string; onChange: (value: string) => void; invalid?: boolean; unit?: string; placeholder?: string };

// A number typed as text: no spinner, and the scroll wheel never changes it. The caller reads and checks it.
export function NumberInput({ label, value, onChange, invalid = false, unit, placeholder }: Props) {
  return (
    <span className={styles.box}>
      <input
        className={styles.input}
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
