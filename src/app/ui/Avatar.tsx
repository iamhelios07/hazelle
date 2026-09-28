import type { LucideIcon } from 'lucide-react';
import styles from './Avatar.module.css';
import { Icon } from './Icon';

type Props = {
  // The first letter of a name, or an icon for something with no picture and no name of its own.
  face: string | LucideIcon;
  // A character's picture. face stands in while there is none.
  image?: string | null;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'plain' | 'you';
};

export function Avatar({ face, image, size = 'md', tone = 'plain' }: Props) {
  return (
    <span className={`${styles.avatar} ${styles[size]} ${styles[tone]}`} aria-hidden>
      {image ? <img className={styles.image} src={image} alt="" /> : typeof face === 'string' ? face.slice(0, 1) : <Icon icon={face} />}
    </span>
  );
}
