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
  const meta =
    code || tags.length > 0 ? (
      <>
        {code && <code className={styles.code}>{code}</code>}
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </>
    ) : undefined;
  return (
    <li className={styles.item}>
      <Item density="tall" scheme="list" title={title} meta={meta} preview={description} trailing={trailing} pressed={selected} current={current && 'page'} onClick={onClick} />
    </li>
  );
}
