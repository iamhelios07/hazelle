import { useId } from 'react';
import { Menu, MenuItem } from '../overlays/Menu';
import { ChipButton } from './ChipButton';
import styles from './ChoiceGroup.module.css';

// fit: a strip while it holds a few short options; more or longer ones, which a strip squeezes to a letter wide each,
// open as a menu from a chip naming the choice.
const STRIP = { options: 4, letters: 14 };

type Props<T extends string> = {
  label: string;
  showLabel?: boolean;
  options: { value: T; label: string; sub?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  layout?: 'chips' | 'buttons' | 'segmented' | 'list' | 'fit';
};

export function ChoiceGroup<T extends string>({ label, showLabel = false, options, value, onChange, layout = 'chips' }: Props<T>) {
  const id = useId();
  if (layout === 'fit') {
    if (options.length <= STRIP.options && options.map((option) => option.label).join('').length <= STRIP.letters) {
      return <ChoiceGroup label={label} showLabel={showLabel} options={options} value={value} onChange={onChange} layout="segmented" />;
    }
    return (
      <Menu label={label} place="below-end" trigger={(opener) => <ChipButton variant="field" label={options.find((option) => option.value === value)?.label ?? value ?? ''} title={label} {...opener} />}>
        {options.map((option) => (
          <MenuItem key={option.value} label={option.label} sub={option.sub} checked={option.value === value} onClick={() => onChange(option.value)} />
        ))}
      </Menu>
    );
  }
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
      <span id={id} className={layout === 'chips' ? styles.fieldLabel : styles.label}>
        {label}
      </span>
      {group}
    </div>
  );
}
