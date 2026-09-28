import type { ReactNode } from 'react';
import { PaneContext } from './layout';
import styles from './ListDetail.module.css';

// A list beside the item picked from it (design F5, desktop). Each pane scrolls on its own, and the
// screens inside take a pane's shape instead of a page's (Screen, NavBar).
export function ListDetail({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className={styles.split}>
      <div className={styles.list}>
        <PaneContext.Provider value="list">{list}</PaneContext.Provider>
      </div>
      <div className={styles.detail}>
        <PaneContext.Provider value="detail">{detail}</PaneContext.Provider>
      </div>
    </div>
  );
}
