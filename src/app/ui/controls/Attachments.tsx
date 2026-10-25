import { TriangleAlert, X } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './Attachments.module.css';

// saving: its file is still being saved; failed: it was not, and goes with nothing until removed.
export type Attached = { key: string; url: string; label: string; state: 'saving' | 'saved' | 'failed' };

// What a message about to be sent carries, above the composer's text.
export function Attachments({ items, onRemove }: { items: readonly Attached[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className={styles.list} aria-label="첨부">
      {items.map(({ key, url, label, state }) => (
        <li key={key} className={`${styles.item} ${state === 'failed' ? styles.failed : ''}`}>
          <img className={styles.picture} src={url} alt={label} />
          {state === 'saving' && (
            <span className={styles.cover} role="status" aria-label="올리는 중">
              <span className={styles.spinner} />
            </span>
          )}
          {state === 'failed' && (
            <span className={`${styles.cover} ${styles.mark}`} role="status" aria-label="올리지 못했어요">
              <Icon icon={TriangleAlert} size="sm" />
            </span>
          )}
          <button type="button" className={styles.remove} aria-label={`${label} 빼기`} title="빼기" onClick={() => onRemove(key)}>
            <Icon icon={X} size="sm" />
          </button>
        </li>
      ))}
    </ul>
  );
}
