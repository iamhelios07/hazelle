import styles from './Switch.module.css';

// An on/off setting that takes effect at once, like a toggle; Checkbox is for a choice made before an action.
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <input className={styles.switch} type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />
  );
}
