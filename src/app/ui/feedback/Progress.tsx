import type { CSSProperties } from 'react';
import motion from '../foundation/motion.module.css';
import styles from './Progress.module.css';

// total absent: how far is unknown, the count alone is shown and the bar flows; done absent too: only the label.
export type ProgressStep = { label: string; done?: number; total?: number };

const count = (value: number) => value.toLocaleString('ko-KR');

function Bar({ label, done = 0, total }: ProgressStep) {
  const known = total !== undefined;
  const share = known ? (total === 0 ? 1 : Math.min(done / total, 1)) : 0;
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.count}>{known ? `${count(done)} / ${count(total)}` : done ? count(done) : ''}</span>
      <div className={styles.track} role="progressbar" aria-label={label} {...(known && { 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': Math.min(done, total) })}>
        {known ? <div className={share >= 1 ? `${styles.fill} ${styles.full}` : styles.fill} style={{ '--progress': share } as CSSProperties} /> : <div className={`${styles.flow} ${motion.slide}`} />}
      </div>
    </div>
  );
}

// Work under way, a row per step: the label, the bar and the count. With two or more counted steps a 전체 row sums them.
export function Progress({ steps }: { steps: ProgressStep[] }) {
  const counted = steps.flatMap(({ done = 0, total }) => (total === undefined ? [] : [{ done, total }]));
  return (
    <div className={styles.progress}>
      {counted.length > 1 && <Bar label="전체" done={counted.reduce((sum, { done, total }) => sum + Math.min(done, total), 0)} total={counted.reduce((sum, { total }) => sum + total, 0)} />}
      {steps.map((step) => <Bar key={step.label} {...step} />)}
    </div>
  );
}
