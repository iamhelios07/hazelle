import type { ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import { Item } from './Item';
import styles from './List.module.css';

export function List({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  );
}

type ItemProps = {
  // Before the title, such as a face.
  leading?: ReactNode;
  title: string;
  // A gold mark beside the title, such as 기본.
  badge?: string;
  // A machine name under the title, such as a model id, set in the mono face.
  code?: string;
  description?: string;
  tags?: string[];
  // A short figure at the end of the row, before trailing, such as a count.
  aside?: string;
  // Something at the end of the row: an icon, a badge, or a control of its own.
  trailing?: ReactNode;
  // With onClick the whole row is one button, so trailing must not hold a control then.
  onClick?: () => void;
  // A control beside the row's button, such as 사본 2 that opens the rows under it.
  control?: ReactNode;
  // Rows under this one, set in from it, such as a prompt's copies.
  children?: ReactNode;
  // pressed: one of a set of choices. current: the item open beside the list (ListDetail).
  selected?: boolean;
  current?: boolean;
};

export function ListItem({ leading, title, badge, code, description, tags = [], aside, trailing, onClick, control, children, selected, current }: ItemProps) {
  const meta =
    code || tags.length > 0 ? (
      <>
        {code && <code className={styles.code}>{code}</code>}
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </>
    ) : undefined;
  const row = (
    <Item
      density="tall"
      scheme="list"
      leading={leading}
      title={
        badge ? (
          <span className={styles.titled}>
            {title}
            <Tag tone="accent">{badge}</Tag>
          </span>
        ) : (
          title
        )
      }
      meta={meta}
      preview={description}
      trailing={
        aside ? (
          <>
            <span className={styles.aside}>{aside}</span>
            {trailing}
          </>
        ) : (
          trailing
        )
      }
      pressed={selected}
      current={current && 'page'}
      onClick={onClick}
    />
  );
  return (
    <li className={styles.item}>
      {control ? (
        <div className={styles.withControl}>
          {row}
          <span className={styles.control}>{control}</span>
        </div>
      ) : (
        row
      )}
      {children && <ul className={styles.nested}>{children}</ul>}
    </li>
  );
}
