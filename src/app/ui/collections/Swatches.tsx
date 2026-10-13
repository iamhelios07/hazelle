import { Check } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Icon } from '../foundation/Icon';
import type { Theme } from '../foundation/theme';
import type { Reading } from '../layout/ChatFrame';
import styles from './Swatches.module.css';

export type Swatch = { name: string; note: string; theme: Theme; font: Reading['font']; size: number; current: boolean; onPick: () => void };

// Each look as a card drawn in its own theme and face whatever the app's, the sample in it; the current one pressed.
export function Swatches({ label, sample, items }: { label: string; sample: string; items: Swatch[] }) {
  return (
    <div className={styles.swatches} role="group" aria-label={label}>
      {items.map(({ name, note, theme, font, size, current, onPick }) => (
        <button key={name} type="button" className={styles.card} aria-pressed={current} onClick={onPick}>
          <span className={`${styles.sample} ${styles[theme]} ${styles[font]}`} style={{ '--swatch-size': `${size}px` } as CSSProperties} aria-hidden>
            {sample}
          </span>
          <span className={styles.meta}>
            <span className={styles.name}>
              {name}
              {current && <Icon icon={Check} size="xs" />}
            </span>
            <span className={styles.note}>{note}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
