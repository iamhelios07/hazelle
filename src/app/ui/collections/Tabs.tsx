import { Item } from './Item';
import styles from './Tabs.module.css';

type TabsProps<T extends string> = { label: string; items: { value: T; label: string; count?: number }[]; value: T; onChange: (value: T) => void };

export function Tabs<T extends string>({ label, items, value, onChange }: TabsProps<T>) {
  return (
    <div className={styles.tabs} role="group" aria-label={label}>
      {items.map((item) => (
        <Item key={item.value} density="chip" scheme="tab" title={item.label} meta={item.count} pressed={item.value === value} onClick={() => onChange(item.value)} />
      ))}
    </div>
  );
}
