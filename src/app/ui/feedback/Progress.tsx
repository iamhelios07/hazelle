import { Circle, CircleCheck, CircleDot } from 'lucide-react';
import { useId, type CSSProperties } from 'react';
import { MARK } from '../foundation/mark';
import motion from '../foundation/motion.module.css';
import styles from './Progress.module.css';

// total absent: how far is unknown, the count alone is shown and the bar flows; done absent too: only the label.
// finished: a label-only step that is over, for a stage done before the counted ones began.
export type ProgressStep = { label: string; done?: number; total?: number; finished?: boolean };
type State = 'done' | 'active' | 'pending';

const count = (value: number) => value.toLocaleString('ko-KR');
const counted = (steps: ProgressStep[]) => steps.flatMap(({ done = 0, total }) => (total === undefined ? [] : [{ done: Math.min(done, total), total }]));
const sum = (steps: ProgressStep[]) => ({ done: counted(steps).reduce((all, { done }) => all + done, 0), total: counted(steps).reduce((all, { total }) => all + total, 0) });
const over = ({ done, total, finished }: ProgressStep) => finished === true || (total !== undefined && (done ?? 0) >= total);

// A stage is over by its own count, under way once begun, and the first not begun is under way as well once every
// stage before it is over: so a label-only stage that follows the counted ones takes its turn without a count of its own.
const stateOf = (steps: ProgressStep[], index: number): State => {
  const step = steps[index]!;
  if (over(step)) return 'done';
  if (step.done !== undefined || steps.slice(0, index).every(over)) return 'active';
  return 'pending';
};

function Track({ label, done = 0, total }: ProgressStep) {
  const known = total !== undefined;
  const share = known ? (total === 0 ? 1 : Math.min(done / total, 1)) : 0;
  return (
    <div className={styles.track} role="progressbar" aria-label={label} {...(known && { 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': Math.min(done, total) })}>
      {known ? <div className={share >= 1 ? `${styles.fill} ${styles.full}` : styles.fill} style={{ '--progress': share } as CSSProperties} /> : <div className={`${styles.flow} ${motion.slide}`} />}
    </div>
  );
}

const Count = ({ done = 0, total }: ProgressStep) => <span className={styles.count}>{total !== undefined ? `${count(done)} / ${count(total)}` : done ? count(done) : ''}</span>;

function Bar(step: ProgressStep) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{step.label}</span>
      <Count {...step} />
      <Track {...step} />
    </div>
  );
}

const ICON = { done: CircleCheck, active: CircleDot, pending: Circle } as const;

function Stage({ step, state }: { step: ProgressStep; state: State }) {
  const Icon = ICON[state];
  return (
    <li className={`${styles.stage} ${styles[state]}`}>
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.label}>{step.label}</span>
      {state === 'active' && <Count {...step} />}
      {state === 'active' && <Track {...step} />}
    </li>
  );
}

const [, , MARK_WIDTH, MARK_HEIGHT] = MARK.viewBox.split(' ').map(Number) as [number, number, number, number];

// The mark fills with the share of all counted work and the percent beside it says the same; neither shows while no
// stage has a total yet.
function Hero({ steps, title, note }: { steps: ProgressStep[]; title?: string; note?: string }) {
  const clip = useId();
  const { done, total } = sum(steps);
  const share = total > 0 ? done / total : null;
  const percent = share === null ? null : Math.floor(share * 100);
  const filled = MARK_HEIGHT * (share ?? 0);
  return (
    <div className={styles.hero}>
      <div className={styles.lead}>
        <svg className={styles.mark} viewBox={MARK.viewBox} role="progressbar" aria-label={title ?? '진행'} {...(percent !== null && { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent })}>
          <defs>
            <clipPath id={clip}><rect x="0" y={MARK_HEIGHT - filled} width={MARK_WIDTH} height={filled} /></clipPath>
          </defs>
          <path className={styles.dim} fillRule="evenodd" d={MARK.path} />
          <path className={styles.gold} clipPath={`url(#${clip})`} fillRule="evenodd" d={MARK.path} />
        </svg>
        <div className={styles.figure}>
          {percent !== null && <span className={styles.percent}>{percent}<span className={styles.unit}>%</span></span>}
          {title && <span className={styles.title}>{title}</span>}
        </div>
      </div>
      <ol className={styles.stages}>
        {steps.map((step, index) => <Stage key={step.label} step={step} state={stateOf(steps, index)} />)}
      </ol>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  );
}

type Props = { steps: ProgressStep[]; hero?: boolean; title?: string; note?: string };

// Work under way. Plain: a row per step with the label, the bar and the count, and with two or more counted steps a
// 전체 row summing them. hero: the mark filling with the whole and the percent, then the steps as stages in order,
// each a check, the one under way with its count and bar, or a hollow ring still to come; title under the percent and
// note under the stages.
export function Progress({ steps, hero = false, title, note }: Props) {
  if (hero) return <Hero steps={steps} title={title} note={note} />;
  const whole = sum(steps);
  return (
    <div className={styles.progress}>
      {counted(steps).length > 1 && <Bar label="전체" done={whole.done} total={whole.total} />}
      {steps.map((step) => <Bar key={step.label} {...step} />)}
    </div>
  );
}
