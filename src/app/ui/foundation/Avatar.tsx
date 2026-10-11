import type { LucideIcon } from 'lucide-react';
import styles from './Avatar.module.css';
import { Icon } from './Icon';
import { useVeil } from './veil';

type Props = {
  face: string | LucideIcon;
  // A character's picture. face stands in while there is none.
  image?: string | null;
  size?: 'sm' | 'md' | 'rail' | 'lg';
  tone?: 'plain' | 'you';
};

export function Avatar({ face, image, size = 'md', tone = 'plain' }: Props) {
  const veil = useVeil();
  return (
    <span className={`${styles.avatar} ${styles[size]} ${styles[tone]}`} aria-hidden>
      {image && !veil ? <img className={styles.image} src={image} alt="" /> : typeof face === 'string' ? face.slice(0, 1) : <Icon icon={face} />}
    </span>
  );
}
