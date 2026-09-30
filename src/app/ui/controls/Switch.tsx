import styles from './Switch.module.css';

// An on/off setting that takes effect at once, like a toggle; Checkbox is for a choice made before an action.
// disabled: a setting that has no effect now, whose row says why.
export function Switch({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <input
      className={styles.switch}
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
