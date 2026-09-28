import styles from './ChoiceGroup.module.css';

type Props<T extends string> = {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  // chips: a row of small filters. buttons: equal-width buttons for a choice the form needs. segmented: one
  // bordered strip of short choices for a setting, such as a reasoning level.
  layout?: 'chips' | 'buttons' | 'segmented';
};

export function ChoiceGroup<T extends string>({ label, options, value, onChange, layout = 'chips' }: Props<T>) {
  return (
    <div className={styles[layout]} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={styles.choice} aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
