import { createContext, useContext, type ReactNode } from 'react';
import styles from './ListDetail.module.css';

const PaneContext = createContext<'list' | 'detail' | 'drawer' | 'stack' | null>(null);

// Which pane of a ListDetail a screen is in, or null on a page of its own.
export const usePane = () => useContext(PaneContext);

// Each pane scrolls on its own, and the screens inside take a pane's shape instead of a page's (Screen, NavBar).
// list: a list beside the item picked from it. drawer: the list takes the width, and the item opens beside it only
// while one is picked (no detail, no pane). stack: one scroll, the list over the picked item.
export function ListDetail({ list, detail, variant = 'list' }: { list: ReactNode; detail: ReactNode | null; variant?: 'list' | 'drawer' | 'stack' }) {
  return (
    <div className={`${styles.split} ${styles[variant]}`}>
      <div className={styles.list}>
        <PaneContext.Provider value="list">{list}</PaneContext.Provider>
      </div>
      {detail !== null && (
        <div className={styles.detail}>
          <PaneContext.Provider value={variant === 'list' ? 'detail' : variant}>{detail}</PaneContext.Provider>
        </div>
      )}
    </div>
  );
}
