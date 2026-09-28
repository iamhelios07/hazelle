import { ChevronDown } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './ChipButton.module.css';

// A rounded button that opens a menu and names its current choice, such as the chat's model.
export function ChipButton({ label, title, expanded, onClick }: { label: string; title: string; expanded: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.chip} title={title} aria-label={`${title} · ${label}`} aria-haspopup="menu" aria-expanded={expanded} onClick={onClick}>
      <span className={styles.label}>{label}</span>
      <Icon icon={ChevronDown} size="xs" />
    </button>
  );
}
