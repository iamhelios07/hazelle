import styles from './Breakdown.module.css';

type Part = { label: string; value: string; mark: 'accent' | 'plain' | 'outline' };

// A total split into parts: a legend with every part's value and, when every share is known, a bar
// with each part's fraction of it, in the parts' order.
export function Breakdown({ parts, shares }: { parts: Part[]; shares: number[] | null }) {
  return (
    <div className={styles.breakdown}>
      {shares && (
        <div className={styles.bar} aria-hidden>
          {shares.map((share, index) => (
            <span key={index} className={styles[parts[index]!.mark]} style={{ width: `${share * 100}%` }} />
          ))}
        </div>
      )}
      <dl className={styles.legend}>
        {parts.map((part) => (
          <div key={part.label} className={styles.row}>
            <span className={`${styles.swatch} ${styles[part.mark]}`} />
            <dt className={styles.label}>{part.label}</dt>
            <dd className={styles.value}>{part.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
