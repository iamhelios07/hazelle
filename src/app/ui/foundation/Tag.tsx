import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './Tag.module.css';

type Props = {
  // success: a thing finished. faint: a thing set aside.
  tone?: 'plain' | 'accent' | 'success' | 'faint';
  // One of the faces' tints (Avatar), which tell kinds apart, such as a post's 분류; it wins over tone.
  hue?: 1 | 2 | 3 | 4 | 5;
  // Alone, without children: a square mark, such as a choice card's.
  icon?: LucideIcon;
  children?: ReactNode;
};

const HUES = { 1: styles.hue1, 2: styles.hue2, 3: styles.hue3, 4: styles.hue4, 5: styles.hue5 };

export function Tag({ tone = 'plain', hue, icon: Glyph, children }: Props) {
  return (
    <span className={`${styles.tag} ${hue ? HUES[hue] : styles[tone]}${children === undefined ? ` ${styles.alone}` : ''}`}>
      {Glyph && <Glyph className={styles.icon} aria-hidden />}
      {children}
    </span>
  );
}
