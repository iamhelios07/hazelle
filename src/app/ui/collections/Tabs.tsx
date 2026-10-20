import type { ReactNode } from 'react';
import { Item } from './Item';
import styles from './Tabs.module.css';

type TabsProps<T extends string> = { label: string } & (
  | { items: { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void; children?: never }
  // Wave 2 moves the callers to items and deletes this form.
  | { children: ReactNode; items?: never; value?: never; onChange?: never }
);

export function Tabs<T extends string>(props: TabsProps<T>) {
  return (
    <div className={styles.tabs} role="group" aria-label={props.label}>
      {props.items ? props.items.map((item) => <Tab key={item.value} label={item.label} count={item.count} current={item.value === props.value} onClick={() => props.onChange(item.value)} />) : props.children}
    </div>
  );
}

type TabProps = { label: string; count?: number; current: boolean; onClick: () => void };

export function Tab({ label, count, current, onClick }: TabProps) {
  return <Item density="chip" scheme="tab" title={label} meta={count} pressed={current} onClick={onClick} />;
}
