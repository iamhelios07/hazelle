import { useId } from 'react';
import styles from './ChoiceGroup.module.css';

type Props<T extends string> = {
  label: string;
  showLabel?: boolean;
  options: { value: T; label: string; sub?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  layout?: 'chips' | 'buttons' | 'segmented' | 'list';
};

export function ChoiceGroup<T extends string>({ label, showLabel = false, options, value, onChange, layout = 'chips' }: Props<T>) {
  const id = useId();
  const group = (
    <div className={styles[layout]} role="group" aria-label={showLabel ? undefined : label} aria-labelledby={showLabel ? id : undefined}>
      {options.map((option) => (
        <button key={option.value} type="button" className={styles.choice} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {layout === 'list' ? (
            <>
              <span className={styles.dot} aria-hidden />
              <span className={styles.text}>
                <span>{option.label}</span>
                {option.sub && <span className={styles.sub}>{option.sub}</span>}
              </span>
            </>
          ) : (
            option.label
          )}
        </button>
      ))}
    </div>
  );
  if (!showLabel) return group;
  // Chips stand as a field among fields, their label above as TextField's; the other layouts sit in a toolbar row.
  return (
    <div className={layout === 'chips' ? styles.field : styles.labelled}>
      <span id={id} className={styles.label}>
        {label}
      </span>
      {group}
    </div>
  );
}
