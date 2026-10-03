import { X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Avatar } from '../foundation/Avatar';
import { formatKeys, type Chord } from '../foundation/keys';
import { Kbd } from '../foundation/Kbd';
import styles from './Toast.module.css';

export type ToastAction = { label: string; onClick: () => void; keys?: readonly Chord[] };

type Props = {
  message: string;
  detail?: string;
  tone: 'plain' | 'error';
  action?: ToastAction;
  // Open, the notice has a × (onClose), and onKeep tells that its time must not take it away.
  from?: { name: string; face: string | null };
  onKeep?: () => void;
  onClose?: () => void;
  // How long it stays, in ms: a notice with an action draws it as a shrinking line, which stops while paused.
  life: number;
  paused: boolean;
};

export function Toast({ message, detail, tone, action, from, onKeep, onClose, life, paused }: Props) {
  const error = tone === 'error';
  const [open, setOpen] = useState(false);
  return (
    <div
      className={[styles.toast, error && styles.error, paused && styles.paused].filter(Boolean).join(' ')}
      role={error ? 'alert' : 'status'}
      style={{ '--life': `${life}ms` } as CSSProperties}
    >
      {from ? (
        <div className={styles.from}>
          <Avatar face={from.name} image={from.face} size="sm" />
          <span className={styles.name}>{from.name}</span>
          {open && <IconButton icon={X} size="xs" label="닫기" onClick={() => onClose?.()} />}
        </div>
      ) : (
        error && <div className={styles.band}>{message}</div>
      )}
      {(!error || detail || action || from) && (
        <div className={styles.row}>
          <div className={styles.text}>
            {from ? (
              <Words
                text={message}
                open={open}
                onOpen={() => {
                  setOpen(true);
                  onKeep?.();
                }}
              />
            ) : (
              !error && <div className={styles.message}>{message}</div>
            )}
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

function Words({ text, open, onOpen }: { text: string; open: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [long, setLong] = useState(false);
  // Measured cut, as a notice's words first are; they never change under it.
  useLayoutEffect(() => setLong(ref.current!.scrollHeight > ref.current!.clientHeight), [text]);
  const words = (
    <span ref={ref} className={open ? `${styles.words} ${styles.whole}` : `${styles.words} ${styles.cut}`}>
      {text}
    </span>
  );
  if (!long || open) return words;
  return (
    <button type="button" className={styles.more} aria-expanded={false} onClick={onOpen}>
      {words}
    </button>
  );
}
