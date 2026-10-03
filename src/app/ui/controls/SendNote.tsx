import { Timer, TriangleAlert } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Hint } from '../overlays/Hint';
import styles from './SendNote.module.css';

type Props = { label: string; title: string; warning?: { words: string; why: string } };

export function SendNote({ label, title, warning }: Props) {
  return (
    <span className={warning ? `${styles.note} ${styles.warn}` : styles.note} title={title}>
      <Icon icon={warning ? TriangleAlert : Timer} size="xs" />
      {label}
      {warning && (
        <>
          <span className={styles.words}>· {warning.words}</span>
          <Hint label={title}>{warning.why}</Hint>
        </>
      )}
    </span>
  );
}
