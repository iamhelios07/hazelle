import { createContext, useContext, type ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import { Item } from './Item';
import { Viewport } from './Viewport';
import styles from './List.module.css';

// In the windowed form the Viewport's rows are the li, so an item renders none of its own.
const Windowed = createContext(false);

export function List(props: { label: string; children: ReactNode } | { label: string; keys: readonly string[]; children: (index: number) => ReactNode }) {
  if ('keys' in props) {
    return (
      <Windowed value>
        <Viewport keys={props.keys} variant="items" list={props.label}>
          {props.children}
        </Viewport>
      </Windowed>
    );
  }
  return (
    <ul className={styles.list} aria-label={props.label}>
      {props.children}
    </ul>
  );
}

type ItemProps = {
  leading?: ReactNode;
  title: string;
  badge?: string;
  code?: string;
  description?: string;
  tags?: string[];
  aside?: string;
  trailing?: ReactNode;
  // With onClick the whole row is one button, so trailing must not hold a control then.
  onClick?: () => void;
  control?: ReactNode;
  children?: ReactNode;
  // pressed: one of a set of choices. current: the item open beside the list (ListDetail).
  selected?: boolean;
  current?: boolean;
};

export function ListItem({ leading, title, badge, code, description, tags = [], aside, trailing, onClick, control, children, selected, current }: ItemProps) {
  const windowed = useContext(Windowed);
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
        (aside || trailing) && (
          <span className={styles.end}>
            {aside && <span className={styles.aside}>{aside}</span>}
            {trailing}
          </span>
        )
      }
      pressed={selected}
      current={current && 'page'}
      onClick={onClick}
    />
  );
  const content = (
    <>
      {control ? (
        <div className={styles.withControl}>
          {row}
          <span className={styles.control}>{control}</span>
        </div>
      ) : (
        row
      )}
      {children && <ul className={styles.nested}>{children}</ul>}
    </>
  );
  return windowed ? content : <li className={styles.item}>{content}</li>;
}
