import { Check } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { schemeAttributes, type Scheme } from '../foundation/theme';
import type { Reading } from '../layout/ChatFrame';
import { MoreMenu } from '../overlays/MoreMenu';
import styles from './Swatches.module.css';

// menu: MenuItems for the look, under a ⋯ by its name.
export type Swatch = Scheme & { name: string; note: string; font: Reading['font']; size: number; current: boolean; onPick: () => void; menu?: ReactNode };

// Each look as a card drawn in its own scheme and face whatever the app's, the sample in it; the current one pressed.
export function Swatches({ label, sample, items }: { label: string; sample: string; items: Swatch[] }) {
  return (
    <div className={styles.swatches} role="group" aria-label={label}>
      {items.map(({ name, note, theme, bg, ink, accent, font, size, current, onPick, menu }, index) => (
        <div key={index} className={styles.card}>
          <button type="button" className={styles.pick} aria-pressed={current} onClick={onPick}>
            <span className={`${styles.sample} ${styles[font]}`} {...schemeAttributes({ theme, bg, ink, accent })} style={{ '--swatch-size': `${size}px` } as CSSProperties} aria-hidden>
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
          {menu && (
            <span className={styles.menu}>
              <MoreMenu of={name} size="xs">
                {menu}
              </MoreMenu>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
