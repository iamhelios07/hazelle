import type { ReactNode } from 'react';
import styles from './StoryAside.module.css';

type Props = { label: string; shown: boolean; actions: ReactNode; children: ReactNode };

// A column in the story's right margin, over the page, for what stays beside the story without moving it, such as
// 상태 kept there. Not shown, it keeps its place and size, so what is in it can still tell whether it fits.
// ChatFrame's aside slot places it.
export function StoryAside({ label, shown, actions, children }: Props) {
  return (
    <aside aria-label={label} aria-hidden={!shown} className={shown ? styles.aside : `${styles.aside} ${styles.hidden}`}>
      <div className={styles.head}>{actions}</div>
      {children}
    </aside>
  );
}
