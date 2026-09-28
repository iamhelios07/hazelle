import type { ReactNode } from 'react';
import { Item } from './Item';
import styles from './ItemRow.module.css';

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
    <Item
      density="regular"
      scheme="side"
      leading={avatar}
      title={title}
      meta={typing ? <span className={styles.typing}>쓰는 중</span> : time}
      preview={preview}
      current={current}
      onClick={onClick}
    />
  );
}
