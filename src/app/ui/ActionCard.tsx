import type { LucideIcon } from 'lucide-react';
import styles from './ActionCard.module.css';
import { Icon } from './Icon';

type Props = {
  tone?: 'default' | 'accent';
  icon: LucideIcon;
  title: string;
  description: string;
  // A card for a feature that does not exist yet is shown disabled with this badge, never as a dead button.
  pending?: string;
  onClick?: () => void;
};

export function ActionCard({ tone = 'default', icon, title, description, pending, onClick }: Props) {
  return (
    <button type="button" className={tone === 'accent' ? `${styles.card} ${styles.accent}` : styles.card} disabled={pending !== undefined} onClick={onClick}>
      <span className={styles.head}>
        <Icon icon={icon} />
        {pending && <span className={styles.badge}>{pending}</span>}
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.description}>{description}</span>
    </button>
  );
}
