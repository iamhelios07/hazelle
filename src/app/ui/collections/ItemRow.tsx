import type { ReactNode } from 'react';
import { Item } from './Item';
import styles from './ItemRow.module.css';

type Props = {
  avatar?: ReactNode;
  title: string;
  time: string;
  typing: boolean;
  preview: string;
  current: boolean;
  onClick: () => void;
};

export function ItemRow({ avatar, title, time, typing, preview, current, onClick }: Props) {
  return (
    <Item
      density="regular"
      scheme="side"
      leading={avatar}
      title={title}
      meta={typing ? <span className={styles.typing}>생성 중</span> : time}
      preview={preview}
      current={current}
      onClick={onClick}
    />
  );
}
