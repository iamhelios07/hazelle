import { Minus, Plus } from 'lucide-react';
import { IconButton } from './IconButton';
import styles from './Stepper.module.css';

type Props = {
  label: string;
  less: string;
  more: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

export function Stepper({ label, less, more, value, min, max, onChange }: Props) {
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <IconButton icon={Minus} label={less} size="sm" disabled={value <= min} onClick={() => onChange(value - 1)} />
      <span className={styles.value} aria-live="polite">
        {value}
      </span>
      <IconButton icon={Plus} label={more} size="sm" disabled={value >= max} onClick={() => onChange(value + 1)} />
    </div>
  );
}
