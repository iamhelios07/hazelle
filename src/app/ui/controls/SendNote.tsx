import { Timer, TriangleAlert } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Hint } from '../overlays/Hint';
import styles from './SendNote.module.css';

type Props = { label: string; title: string; warning?: { words: string; why: string } };

// A few words beside the send button about what sending now does, such as the prompt cache's time left. A warning
// adds its words, which phones leave to the icon so the send button keeps its place, and its reason behind an ⓘ.
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
