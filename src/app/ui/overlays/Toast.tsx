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
  tone: 'plain' | 'warn';
  action?: ToastAction;
  // Someone's long words, once opened, stay: onKeep tells that their time must not take them away.
  from?: { name: string; face: string | null };
  onKeep?: () => void;
  // The × that puts it away, shown where a pointer can hover; on a phone a notice that stays shows it too, and the
  // others are slid away (ToastStack).
  onClose?: () => void;
  // How long it stays, in ms: a notice with an action draws it as a shrinking line, which stops while paused.
  life: number;
  paused: boolean;
};

export function Toast({ message, detail, tone, action, from, onKeep, onClose, life, paused }: Props) {
  const warn = tone === 'warn';
  const [open, setOpen] = useState(false);
  const close = onClose && (
    <span className={styles.close}>
      <IconButton icon={X} size="xs" label="닫기" onClick={onClose} />
    </span>
  );
  return (
    <div
      className={[styles.toast, warn && styles.warn, paused && styles.paused, open && styles.kept].filter(Boolean).join(' ')}
      role={warn ? 'alert' : 'status'}
      style={{ '--life': `${life}ms` } as CSSProperties}
    >
      {from ? (
        <div className={styles.from}>
          <Avatar face={from.name} image={from.face} size="sm" />
          <span className={styles.name}>{from.name}</span>
          {close}
        </div>
      ) : (
        warn && (
          <div className={styles.band}>
            <span className={styles.text}>{message}</span>
            {close}
          </div>
        )
      )}
      {(!warn || detail || action || from) && (
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
              !warn && <div className={styles.message}>{message}</div>
            )}
            {detail && <div className={styles.detail}>{detail}</div>}
          </div>
          {action && (
            <span className={styles.action}>
              <Button variant={warn ? 'primary' : 'ghost'} size="sm" label={action.keys && `${action.label} · ${formatKeys(action.keys)}`} onClick={action.onClick}>
                {action.label}
                {action.keys && <Kbd>{formatKeys(action.keys)}</Kbd>}
              </Button>
            </span>
          )}
          {!from && !warn && close}
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
