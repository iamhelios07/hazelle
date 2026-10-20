import { Minus } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './Outcome.module.css';

type Item = { title: string; note?: string };

export function Outcome({ label, items }: { label: string; items: Item[] }) {
  return (
    <ul className={styles.outcome} aria-label={label}>
      {items.map((item, index) => (
        <li key={index} className={styles.item}>
          <span className={styles.icon}>
            <Icon icon={Minus} size="xs" />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{item.title}</span>
            {item.note && <span className={styles.detail}>{item.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
