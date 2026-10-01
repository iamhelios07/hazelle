import { Check, Minus } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './Outcome.module.css';

type Item = { tone: 'done' | 'missed'; title: string; note?: string };

// What an import did and did not bring, one line each, with why under a line that needs it.
export function Outcome({ label, items }: { label: string; items: Item[] }) {
  return (
    <ul className={styles.outcome} aria-label={label}>
      {items.map((item, index) => (
        <li key={index} className={`${styles.item} ${styles[item.tone]}`}>
          <span className={styles.icon}>
            <Icon icon={item.tone === 'done' ? Check : Minus} size="xs" />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{item.title}</span>
            {item.note && <span className={styles.note}>{item.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
