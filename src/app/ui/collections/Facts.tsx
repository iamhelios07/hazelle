import styles from './Facts.module.css';

type Item = { label: string; value: string; tone?: 'muted' | 'warn' };

// Label and value pairs, such as a reply's receipt. tiles sets each pair in a box, two to a row.
export function Facts({ items, variant = 'plain' }: { items: Item[]; variant?: 'plain' | 'tiles' }) {
  return (
    <dl className={variant === 'tiles' ? `${styles.facts} ${styles.tiles}` : styles.facts}>
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `${styles.item} ${styles[item.tone]}` : styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
