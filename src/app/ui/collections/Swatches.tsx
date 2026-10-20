import { Check } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { faceStyle } from '../foundation/fonts';
import { Icon } from '../foundation/Icon';
import { schemeAttributes, type Scheme } from '../foundation/theme';
import type { Reading } from '../layout/ChatFrame';
import { MoreMenu } from '../overlays/MoreMenu';
import { useDragOrder } from './dragOrder';
import styles from './Swatches.module.css';

// menu: MenuItems for the look, under a ⋯ by its name.
export type Swatch = Scheme & { name: string; note: string; font: Reading['font']; size: number; current: boolean; onPick: () => void; menu?: ReactNode };

// Each look as a card drawn in its own scheme and face whatever the app's, the sample in it; the current one pressed.
// onMove: the cards can be dragged into another order; to is the index a card ends at.
export function Swatches({ label, sample, items, onMove }: { label: string; sample: string; items: Swatch[]; onMove?: (from: number, to: number) => void }) {
  const order = useDragOrder(onMove ?? (() => {}), 'x');
  return (
    <div className={styles.swatches} role="group" aria-label={label} onDragOver={order.allow} onDrop={order.drop}>
      {items.map(({ name, note, theme, bg, ink, accent, dialogue, font, size, current, onPick, menu }, index) => (
        <div
          key={index}
          className={[styles.card, order.from === index && styles.dragged, order.at === index && styles.before, index === items.length - 1 && order.at === items.length && styles.after].filter(Boolean).join(' ')}
          onDragOver={(event) => order.over(event, index)}
        >
          <button type="button" className={styles.pick} aria-pressed={current} onClick={onPick} draggable={onMove !== undefined} onDragStart={(event) => order.start(event, index, name)} onDragEnd={order.end}>
            <span className={styles.sample} {...schemeAttributes({ theme, bg, ink, accent, dialogue })} style={{ ...faceStyle(font), '--swatch-size': `${size}px` } as CSSProperties} aria-hidden>
              {sample}
            </span>
            <span className={styles.meta}>
              <span className={styles.name}>
                {name}
                {current && <Icon icon={Check} size="xs" />}
              </span>
              <span className={styles.detail}>{note}</span>
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
