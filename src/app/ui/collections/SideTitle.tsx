import type { ReactNode } from 'react';
import styles from './SideTitle.module.css';

// The character whose chats the list shows. With onOpen, its face and name open the character's own
// page; on phones the list is that page.
export function SideTitle({ avatar, name, onOpen, children }: { avatar: ReactNode; name: string; onOpen?: () => void; children?: ReactNode }) {
  const title = (
    <>
      {avatar}
      <span className={styles.heading}>{name}</span>
    </>
  );
  return (
    <div className={styles.sideTitle}>
      {onOpen ? (
        <button type="button" className={`${styles.titleBox} ${styles.titleButton}`} onClick={onOpen}>
          {title}
        </button>
      ) : (
        <span className={styles.titleBox}>{title}</span>
      )}
      {children}
    </div>
  );
}
