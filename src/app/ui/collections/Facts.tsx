import styles from './Facts.module.css';

// detail: smaller lines under the value.
type Item = { label: string; value: string; detail?: string[]; tone?: 'muted' | 'warn' };

// tiles: on a panel's own ground, two to a line. row: in a card, all in one line, as a few periods compared; two to a
// line on a phone.
export function Facts({ items, variant = 'plain' }: { items: Item[]; variant?: 'plain' | 'tiles' | 'row' }) {
  return (
    <dl className={[styles.facts, variant !== 'plain' && styles[variant]].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `${styles.item} ${styles[item.tone]}` : styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
          {item.detail?.map((line) => (
            <dd key={line} className={styles.detail}>
              {line}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}
