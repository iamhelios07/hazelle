import { Minus } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './Outcome.module.css';

type Item = { title: string; note?: string };

export function Outcome({ title, items }: { title: string; items: Item[] }) {
  return (
    <section className={styles.outcome} aria-label={title}>
      <span className={styles.head}>{title}</span>
      {items.map((item, index) => (
        <div key={index} className={styles.item}>
          <span className={styles.icon}>
            <Icon icon={Minus} size="xs" />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>{item.title}</span>
            {item.note && <span className={styles.detail}>{item.note}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}
