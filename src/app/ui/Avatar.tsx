import type { LucideIcon } from 'lucide-react';
import styles from './Avatar.module.css';
import { Icon } from './Icon';

type Props = {
  // The first letter of a name, or an icon for something with no picture and no name of its own.
  face: string | LucideIcon;
  size?: 'sm' | 'md';
  tone?: 'plain' | 'you';
};

export function Avatar({ face, size = 'md', tone = 'plain' }: Props) {
  return (
    <span className={`${styles.avatar} ${styles[size]} ${styles[tone]}`} aria-hidden>
      {typeof face === 'string' ? face.slice(0, 1) : <Icon icon={face} />}
    </span>
  );
}
