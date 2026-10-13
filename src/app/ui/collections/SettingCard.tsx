import type { ReactNode } from 'react';
import { Panel } from '../layout/Panel';
import styles from './SettingCard.module.css';

// One setting as a card of its own, among a few set side by side (Columns): its name and ⓘ, its field, a fact under it.
export function SettingCard({ label, help, sub, error, children }: { label: string; help?: string; sub?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <Panel title={label} level={3} help={help}>
      <div className={styles.body}>
        {children}
        {sub && <span className={styles.sub}>{sub}</span>}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
