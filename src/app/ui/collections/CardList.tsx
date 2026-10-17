import type { LucideIcon } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { cardDrag, useCardDrop } from './cardDrag';
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
  // Before the title, such as a folder's mark.
  icon?: LucideIcon;
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
  // One of a pick of several; absent while not picking.
  selected?: boolean;
  // The card can be dragged onto a folder, carrying this key.
  drag?: string;
  // A dragged card's key, let go over this one (a folder).
  onDropCard?: (key: string) => void;
};

export function CardItem({ icon, title, badge, tags = [], aside, control, onClick, children, selected, drag, onDropCard }: Props) {
  const folded = useContext(Folded);
  const drop = useCardDrop(onDropCard);
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
    <li className={[folded ? undefined : styles.card, drop.over && styles.dropping].filter(Boolean).join(' ') || undefined} {...(drag === undefined ? {} : cardDrag(drag))} {...drop.props}>
      <div className={styles.head}>
        <Item density="regular" scheme="list" leading={icon && <Icon icon={icon} size="sm" />} title={title} meta={meta} preview={aside} pressed={selected} onClick={onClick} />
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
