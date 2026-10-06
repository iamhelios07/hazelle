import { createContext, useContext, type ReactNode } from 'react';
import styles from './ListDetail.module.css';

const PaneContext = createContext<'list' | 'detail' | null>(null);

// Which pane of a ListDetail a screen is in, or null on a page of its own.
export const usePane = () => useContext(PaneContext);

// Each pane scrolls on its own, and the screens inside take a pane's shape instead of a page's (Screen, NavBar).
// grid: a list of faces takes the width, beside a detail of a fixed width.
export function ListDetail({ list, detail, variant = 'list' }: { list: ReactNode; detail: ReactNode; variant?: 'list' | 'grid' }) {
  return (
    <div className={variant === 'grid' ? `${styles.split} ${styles.grid}` : styles.split}>
      <div className={styles.list}>
        <PaneContext.Provider value="list">{list}</PaneContext.Provider>
      </div>
      <div className={styles.detail}>
        <PaneContext.Provider value="detail">{detail}</PaneContext.Provider>
      </div>
    </div>
  );
}
