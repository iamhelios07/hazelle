import type { CSSProperties } from 'react';
import { Button } from '../controls/Button';
import { formatKeys, type Chord } from '../foundation/keys';
import { Kbd } from '../foundation/Kbd';
import styles from './Toast.module.css';

export type ToastAction = { label: string; onClick: () => void; keys?: readonly Chord[] };

type Props = {
  message: string;
  // What it was done to, or for an error why.
  detail?: string;
  tone: 'plain' | 'error';
  action?: ToastAction;
  // How long it stays, in ms: a notice with an action draws it as a shrinking line, which stops while paused.
  life: number;
  paused: boolean;
};

export function Toast({ message, detail, tone, action, life, paused }: Props) {
  const error = tone === 'error';
  return (
    <div
      className={[styles.toast, error && styles.error, paused && styles.paused].filter(Boolean).join(' ')}
      role={error ? 'alert' : 'status'}
      style={{ '--life': `${life}ms` } as CSSProperties}
    >
      {error && <div className={styles.band}>{message}</div>}
      {(!error || detail || action) && (
        <div className={styles.row}>
          <div className={styles.text}>
            {!error && <div className={styles.message}>{message}</div>}
            {detail && <div className={styles.detail}>{detail}</div>}
          </div>
          {action && (
            <span className={styles.action}>
              <Button variant={error ? 'primary' : 'ghost'} size="sm" label={action.keys && `${action.label} · ${formatKeys(action.keys)}`} onClick={action.onClick}>
                {action.label}
                {action.keys && <Kbd>{formatKeys(action.keys)}</Kbd>}
              </Button>
            </span>
          )}
        </div>
      )}
      {action && <div className={styles.time} />}
    </div>
  );
}
