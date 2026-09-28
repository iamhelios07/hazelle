import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import styles from './Dialog.module.css';

// A small window over the page. Esc or a press outside it closes it.
export function Dialog({ title, note, onClose, children }: { title: string; note?: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    const key = (event: KeyboardEvent) => event.key === 'Escape' && close.current();
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      opener?.focus();
    };
  }, []);
  return (
    <div className={styles.scrim} onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={box} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <IconButton icon={X} label="닫기" size="sm" onClick={onClose} />
        </div>
        {note && <p className={styles.note}>{note}</p>}
        {children}
      </div>
    </div>
  );
}

// Keyboard shortcuts, each with its keys drawn as key caps.
export function Shortcuts({ items }: { items: { label: string; keys: string[] }[] }) {
  return (
    <dl className={styles.shortcuts}>
      {items.map((item) => (
        <div key={item.label} className={styles.shortcut}>
          <dt className={styles.action}>{item.label}</dt>
          <dd className={styles.keys}>
            {item.keys.map((key) => (
              <kbd key={key} className={styles.key}>
                {key}
              </kbd>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
