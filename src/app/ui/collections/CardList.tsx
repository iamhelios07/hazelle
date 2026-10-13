import { createContext, useContext, type ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import { Item } from './Item';
import styles from './CardList.module.css';

const Folded = createContext(false);

// The user's own things as cards across the width, as many columns as fit: one in a side panel or on a phone.
export function CardList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  );
}

type Props = {
  title: string;
  badge?: string;
  tags?: string[];
  // Where it is used, under the title.
  aside?: string;
  // Beside the card's button, such as the one that unfolds its children.
  control?: ReactNode;
  onClick: () => void;
  // Things folded under this one, such as its copies: rows inside the card, not cards of their own.
  children?: ReactNode;
};

export function CardItem({ title, badge, tags = [], aside, control, onClick, children }: Props) {
  const folded = useContext(Folded);
  const meta =
    badge || tags.length > 0 ? (
      <>
        {badge && <Tag tone="accent">{badge}</Tag>}
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </>
    ) : undefined;
  return (
    <li className={folded ? styles.row : styles.card}>
      <div className={styles.head}>
        <Item density="regular" scheme="list" title={title} meta={meta} preview={aside} onClick={onClick} />
        {control && <span className={styles.control}>{control}</span>}
      </div>
      {children && (
        <Folded value>
          <ul className={styles.folded}>{children}</ul>
        </Folded>
      )}
    </li>
  );
}
