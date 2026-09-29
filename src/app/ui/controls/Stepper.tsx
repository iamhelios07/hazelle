import { Minus, Plus } from 'lucide-react';
import { IconButton } from './IconButton';
import styles from './Stepper.module.css';

type Props = {
  label: string;
  // The two buttons' names, such as 글자 작게 and 글자 크게.
  less: string;
  more: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

// A whole number stepped one at a time between min and max, such as the story's text size.
export function Stepper({ label, less, more, value, min, max, onChange }: Props) {
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <IconButton icon={Minus} label={less} size="xs" disabled={value <= min} onClick={() => onChange(value - 1)} />
      <span className={styles.value} aria-live="polite">
        {value}
      </span>
      <IconButton icon={Plus} label={more} size="xs" disabled={value >= max} onClick={() => onChange(value + 1)} />
    </div>
  );
}
