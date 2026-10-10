import { ChevronRight } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { Item } from './Item';
import { Viewport } from './Viewport';
import styles from './List.module.css';

// In the windowed form the Viewport's rows are the li, so an item renders none of its own.
const Windowed = createContext(false);
const Places = createContext(false);

// box: the rows in one box, as SettingGroup's are, for a short list a screen leads with. places: rows that go to
// another page (설정's pages, a character's parts, the kinds of connection), each with a ›; a list of the user's own
// things opens them beside it and takes none.
export function List(props: { label: string; box?: boolean; places?: boolean; children: ReactNode } | { label: string; keys: readonly string[]; children: (index: number) => ReactNode }) {
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
    <Places value={props.places ?? false}>
      <ul className={props.box ? `${styles.list} ${styles.box}` : styles.list} aria-label={props.label}>
        {props.children}
      </ul>
    </Places>
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
  // Under the row's text, such as a gauge.
  detail?: ReactNode;
  children?: ReactNode;
  // pressed: one of a set of choices. current: the item open beside the list (ListDetail). expanded: the row opens
  // its detail in place.
  selected?: boolean;
  current?: boolean;
  expanded?: boolean;
};

export function ListItem({ leading, title, badge, code, description, tags = [], aside, trailing, onClick, control, detail, children, selected, current, expanded }: ItemProps) {
  const windowed = useContext(Windowed);
  const places = useContext(Places);
  const end = trailing ?? (places && onClick ? <Icon icon={ChevronRight} /> : undefined);
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
        (aside || end) && (
          <span className={styles.end}>
            {aside && <span className={styles.aside}>{aside}</span>}
            {end}
          </span>
        )
      }
      pressed={selected}
      current={current && 'page'}
      expanded={expanded}
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
      {detail && <div className={styles.detail}>{detail}</div>}
      {children && <ul className={styles.nested}>{children}</ul>}
    </>
  );
  return windowed ? content : <li className={styles.item}>{content}</li>;
}
