import type { ReactNode } from 'react';
import styles from './SideRow.module.css';

type Props = {
  // A character's face. A chat inside a character has none.
  avatar?: ReactNode;
  title: string;
  // Replaced by 쓰는 중 while a reply is being written.
  time: string;
  typing: boolean;
  preview: string;
  current: boolean;
  onClick: () => void;
};

// One character, or one of a character's chats, in the sidebar list.
export function ItemRow({ avatar, title, time, typing, preview, current, onClick }: Props) {
  return (
    <button type="button" className={current ? `${styles.item} ${styles.current}` : styles.item} aria-current={current || undefined} onClick={onClick}>
      {avatar}
      <span className={styles.text}>
        <span className={styles.line}>
          <span className={styles.title}>{title}</span>
          <span className={typing ? `${styles.time} ${styles.typing}` : styles.time}>{typing ? '쓰는 중' : time}</span>
        </span>
        <span className={styles.preview}>{preview}</span>
      </span>
    </button>
  );
}
