import type { ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import styles from './ItemCard.module.css';

type Props = {
  title: string;
  description?: string;
  tags?: string[];
  // Under the words, such as a Gauge; the card is one button, so it holds no control.
  detail?: ReactNode;
  // The item open under or beside the cards (ListDetail).
  current?: boolean;
  onClick: () => void;
};

// One of the user's things as a card in a grid (Columns), opening it.
export function ItemCard({ title, description, tags = [], detail, current, onClick }: Props) {
  return (
    <button type="button" className={styles.card} aria-current={current || undefined} onClick={onClick}>
      <span className={styles.head}>
        <span className={styles.title}>{title}</span>
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </span>
      {description && <span className={styles.description}>{description}</span>}
      {detail}
    </button>
  );
}
