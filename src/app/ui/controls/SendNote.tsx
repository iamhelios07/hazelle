import { Timer } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Hint } from '../overlays/Hint';
import styles from './SendNote.module.css';

type Props = { tone: 'plain' | 'warn'; label: string; title: string; hint?: string };

// A few words beside the send button about what sending now does, such as the prompt cache's time left; warn, with
// the reason behind an ⓘ, when it is about to go wrong.
export function SendNote({ tone, label, title, hint }: Props) {
  return (
    <span className={tone === 'warn' ? `${styles.note} ${styles.warn}` : styles.note} title={title}>
      <Icon icon={Timer} size="xs" />
      {label}
      {hint && <Hint label={title}>{hint}</Hint>}
    </span>
  );
}
