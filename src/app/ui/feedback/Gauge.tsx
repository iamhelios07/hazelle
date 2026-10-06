import type { CSSProperties } from 'react';
import styles from './Gauge.module.css';

// share and mark are fractions of the whole: what is used, and where an even use would stand by now. Without share
// there is nothing to measure against, so only the figures show.
type Props = {
  label?: string;
  share?: number;
  mark?: number;
  tone?: 'plain' | 'accent' | 'warn';
  status?: string;
  note?: string;
  amount: string;
  of?: string;
};

const fraction = (value: number) => Math.max(0, Math.min(1, value));

export function Gauge({ label, share, mark, tone = 'plain', status, note, amount, of }: Props) {
  return (
    <div className={styles.gauge}>
      {label && <span className={styles.label}>{label}</span>}
      {share !== undefined && (
        <div className={styles.track} role="meter" aria-label={label ?? status ?? amount} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction(share) * 100)}>
          <div className={tone === 'warn' ? `${styles.fill} ${styles.warn}` : styles.fill} style={{ '--share': fraction(share) } as CSSProperties} />
          {mark !== undefined && <div className={styles.mark} style={{ '--mark': fraction(mark) } as CSSProperties} />}
        </div>
      )}
      <div className={styles.figures}>
        {status && <span className={`${styles.status} ${styles[tone]}`}>{status}</span>}
        {note && <span className={styles.note}>{note}</span>}
        <span className={styles.amount}>
          <span className={styles.big}>{amount}</span>
          {of && <span className={styles.of}> {of}</span>}
        </span>
      </div>
    </div>
  );
}
