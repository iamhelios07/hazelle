import type { ReactNode } from 'react';
import styles from './SideTitle.module.css';

export function SideTitle({ avatar, name, onOpen }: { avatar: ReactNode; name: string; onOpen?: () => void }) {
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
    </div>
  );
}
