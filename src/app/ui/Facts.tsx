import styles from './Facts.module.css';

// Label and value pairs, such as a reply's receipt.
export function Facts({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className={styles.facts}>
      {items.map((item) => (
        <div key={item.label} className={styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
