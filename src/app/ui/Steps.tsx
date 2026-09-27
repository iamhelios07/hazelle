import styles from './Steps.module.css';

export function Steps({ current, total }: { current: number; total: number }) {
  return (
    <div className={styles.steps} role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={current} aria-label={`${total}단계 중 ${current}단계`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < current ? `${styles.step} ${styles.done}` : styles.step} />
      ))}
    </div>
  );
}
