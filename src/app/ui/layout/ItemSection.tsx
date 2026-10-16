import type { ReactNode } from 'react';
import { MoreMenu } from '../overlays/MoreMenu';
import styles from './ItemSection.module.css';

type Props = {
  title: string;
  note?: string;
  // MenuItems for the thing as a whole, under a ⋯ by its title, as NavBar's menu.
  menu: { of: string; items: ReactNode };
  children: ReactNode;
};

export function ItemSection({ title, note, menu, children }: Props) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.head}>
        <div className={styles.titles}>
          <h2 className={styles.title}>{title}</h2>
          {note && <span className={styles.note}>{note}</span>}
        </div>
        <MoreMenu of={menu.of}>{menu.items}</MoreMenu>
      </div>
      {children}
    </section>
  );
}
