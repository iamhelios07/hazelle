import { useId } from 'react';
import styles from './ChoiceGroup.module.css';

type Props<T extends string> = {
  label: string;
  // Shows the label before the options instead of only telling screen readers.
  showLabel?: boolean;
  options: { value: T; label: string; sub?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  // chips: a row of small filters. buttons: equal-width buttons for a choice the form needs. segmented: one
  // bordered strip of short choices for a setting, such as a reasoning level or a block's role. list: a column of
  // options with a line under each, such as a model.
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
  return (
    <div className={styles.labelled}>
      <span id={id} className={styles.label}>
        {label}
      </span>
      {group}
    </div>
  );
}
