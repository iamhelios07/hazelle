import { ChevronDown } from 'lucide-react';
import type { Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './ChipButton.module.css';

type Props = { label: string; title: string; popup: 'menu'; expanded: boolean; ref: Ref<HTMLButtonElement>; onClick: () => void };

// A rounded button that opens a menu and names its current choice, such as the chat's model.
export function ChipButton({ label, title, popup, expanded, ref, onClick }: Props) {
  return (
    <button ref={ref} type="button" className={styles.chip} title={title} aria-label={`${title} · ${label}`} aria-haspopup={popup} aria-expanded={expanded} onClick={onClick}>
      <span className={styles.label}>{label}</span>
      <Icon icon={ChevronDown} size="xs" />
    </button>
  );
}
