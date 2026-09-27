import type { LucideIcon } from 'lucide-react';
import styles from './Icon.module.css';

export function Icon({ icon: Glyph }: { icon: LucideIcon }) {
  return <Glyph className={styles.icon} aria-hidden />;
}
