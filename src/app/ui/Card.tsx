import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Card.module.css';
import { Icon } from './Icon';

type Props = { tone?: 'default' | 'accent'; icon: LucideIcon; title: string; children: ReactNode };

export function Card({ tone = 'default', icon, title, children }: Props) {
  return (
    <div className={tone === 'accent' ? `${styles.card} ${styles.accent}` : styles.card}>
      <Icon icon={icon} />
      <p className={styles.title}>{title}</p>
      <p className={styles.body}>{children}</p>
    </div>
  );
}
