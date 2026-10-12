import { Timer, TriangleAlert } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Hint } from '../overlays/Hint';
import styles from './SendNote.module.css';

// onClick: the note opens where its reason is told at length, so it is a button and keeps no ⓘ of its own.
type Props = { label: string; title: string; warning?: { words: string; why: string }; onClick?: () => void };

export function SendNote({ label, title, warning, onClick }: Props) {
  const className = [styles.note, warning && styles.warn, onClick && styles.press].filter(Boolean).join(' ');
  const body = (
    <>
      <Icon icon={warning ? TriangleAlert : Timer} size="xs" />
      {label}
      {warning && <span className={styles.words}>· {warning.words}</span>}
    </>
  );
  if (onClick)
    return (
      <button type="button" className={className} title={warning ? `${title} · ${warning.why}` : title} onClick={onClick}>
        {body}
      </button>
    );
  return (
    <span className={className} title={title}>
      {body}
      {warning && <Hint label={title}>{warning.why}</Hint>}
    </span>
  );
}
