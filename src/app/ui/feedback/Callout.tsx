import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Callout.module.css';

const ICONS = { warn: TriangleAlert, success: CircleCheck };

// alert: the callout reports the outcome of something the user just did, so screen readers announce it.
export function Callout({ tone, alert = false, children }: { tone: keyof typeof ICONS; alert?: boolean; children: ReactNode }) {
  return (
    <div className={`${styles.callout} ${styles[tone]}`} role={alert ? 'alert' : undefined}>
      <span className={styles.icon}>
        <Icon icon={ICONS[tone]} />
      </span>
      <p>{children}</p>
    </div>
  );
}
