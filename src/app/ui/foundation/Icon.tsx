import type { LucideIcon } from 'lucide-react';
import styles from './Icon.module.css';

export function Icon({ icon: Glyph, size = 'md' }: { icon: LucideIcon; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return <Glyph className={`${styles.icon} ${styles[size]}`} aria-hidden />;
}
