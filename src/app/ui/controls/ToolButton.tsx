import type { LucideIcon } from 'lucide-react';
import type { Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './ToolButton.module.css';

type Props = {
  icon: LucideIcon;
  label: string;
  // What the mark means, read after the label, such as "처음 값과 다른 것 3개".
  detail?: string;
  // count: shown from 1. dot: the chat has its own.
  mark?: { kind: 'count'; count: number } | { kind: 'dot' };
  expanded: boolean;
  // icon: on a phone the label is left out, so the header keeps room for the chat's title.
  phone?: 'full' | 'icon';
  // One that opens a form from Menu takes popup and ref too; one that shows and hides a panel takes expanded alone.
  popup?: 'menu' | 'dialog';
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
};

// A labeled tool around a chat's story, such as 토글 in the header and 노트 in the composer.
export function ToolButton({ icon, label, detail, mark, phone = 'full', expanded, popup, ref, onClick }: Props) {
  const shown = mark?.kind === 'dot' || (mark?.kind === 'count' && mark.count > 0);
  return (
    <button
      ref={ref}
      type="button"
      className={phone === 'icon' ? `${styles.tool} ${styles.phoneIcon}` : styles.tool}
      title={label}
      aria-label={detail ? `${label}, ${detail}` : label}
      aria-haspopup={popup}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <Icon icon={icon} size="xs" />
      <span className={styles.label}>{label}</span>
      {shown &&
        (mark.kind === 'dot' ? (
          <span className={styles.dot} aria-hidden />
        ) : (
          <span className={styles.count} aria-hidden>
            {mark.count}
          </span>
        ))}
    </button>
  );
}
