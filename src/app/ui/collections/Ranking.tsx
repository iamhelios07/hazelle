import styles from './Ranking.module.css';

// rank: null for a row that holds no place, such as a pool of the rest, shown last. share: the bar, of the largest.
export type Ranked = { key: string; rank: number | null; name: string; detail: string; value: string; share: number };

const PLACES: Record<number, string> = { 1: styles.first, 2: styles.second, 3: styles.third };

export function Ranking({ label, items }: { label: string; items: Ranked[] }) {
  return (
    <ol className={styles.ranking} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className={[styles.row, item.rank === null ? '' : PLACES[item.rank]].filter(Boolean).join(' ')}>
          <span className={styles.place}>{item.rank ?? '–'}</span>
          <div className={styles.body}>
            <span className={styles.name}>{item.name}</span>
            <span className={styles.detail}>{item.detail}</span>
            <span className={styles.track} aria-hidden>
              <span className={styles.fill} style={{ width: `${item.share * 100}%` }} />
            </span>
          </div>
          <span className={styles.value}>{item.value}</span>
        </li>
      ))}
    </ol>
  );
}
