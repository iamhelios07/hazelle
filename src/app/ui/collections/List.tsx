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
  title: string;
  // A gold mark beside the title, such as 기본.
  badge?: string;
  // A machine name under the title, such as a model id, set in the mono face.
  code?: string;
  description?: string;
  tags?: string[];
  // Something at the end of the row: an icon, a badge, or a control of its own.
  trailing?: ReactNode;
  // With onClick the whole row is one button, so trailing must not hold a control then.
  onClick?: () => void;
  // A control beside the row's button, such as 사본 2 that opens the rows under it.
  aside?: ReactNode;
  // Rows under this one, set in from it, such as a prompt's copies.
  children?: ReactNode;
  // pressed: one of a set of choices. current: the item open beside the list (ListDetail).
  selected?: boolean;
  current?: boolean;
};

export function ListItem({ title, badge, code, description, tags = [], trailing, onClick, aside, children, selected, current }: ItemProps) {
  const meta =
    code || tags.length > 0 ? (
      <>
        {code && <code className={styles.code}>{code}</code>}
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </>
    ) : undefined;
  const heading = badge ? (
    <span className={styles.titled}>
      {title}
      <Tag tone="accent">{badge}</Tag>
    </span>
  ) : (
    title
  );
  const row = <Item density="tall" scheme="list" title={heading} meta={meta} preview={description} trailing={trailing} pressed={selected} current={current && 'page'} onClick={onClick} />;
  return (
    <li className={styles.item}>
      {aside ? (
        <div className={styles.withAside}>
          {row}
          <span className={styles.aside}>{aside}</span>
        </div>
      ) : (
        row
      )}
      {children && <ul className={styles.nested}>{children}</ul>}
    </li>
  );
}
