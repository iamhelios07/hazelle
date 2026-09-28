import type { ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import styles from './List.module.css';

export function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  );
}

type ItemProps = {
  title: string;
  // A machine name under the title, such as a model id, set in the mono face.
  code?: string;
  description?: string;
  tags?: string[];
  // Something at the end of the row: an icon, a badge, or a control of its own.
  trailing?: ReactNode;
  // With onClick the whole row is one button, so trailing must not hold a control then.
  onClick?: () => void;
  // pressed: one of a set of choices. current: the item open beside the list (ListDetail).
  selected?: boolean;
  current?: boolean;
};

export function ListItem({ title, code, description, tags = [], trailing, onClick, selected, current }: ItemProps) {
  const content = (
    <>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {(code || tags.length > 0) && (
          <span className={styles.meta}>
            {code && <code className={styles.code}>{code}</code>}
            {tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </span>
        )}
        {description && <span className={styles.description}>{description}</span>}
      </span>
      {trailing}
    </>
  );
  return (
    <li className={styles.item}>
      {onClick ? (
        <button type="button" className={`${styles.row} ${styles.button}`} aria-pressed={selected} aria-current={current ? 'page' : undefined} onClick={onClick}>
          {content}
        </button>
      ) : (
        <div className={styles.row}>{content}</div>
      )}
    </li>
  );
}
