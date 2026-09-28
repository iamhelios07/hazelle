import type { ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import styles from './Tiles.module.css';

// A few items to pick again, two to a row where there is room, such as the prompts used last.
export function Tiles({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.tiles} aria-label={label}>
      {children}
    </ul>
  );
}

export function Tile({ title, badge, meta, onClick }: { title: string; badge?: string; meta: string; onClick: () => void }) {
  return (
    <li className={styles.item}>
      <button type="button" className={styles.tile} onClick={onClick}>
        <span className={styles.head}>
          <span className={styles.title}>{title}</span>
          {badge && <Tag tone="accent">{badge}</Tag>}
        </span>
        <span className={styles.meta}>{meta}</span>
      </button>
    </li>
  );
}
