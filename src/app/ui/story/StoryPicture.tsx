import { useReducer, type CSSProperties, type ReactNode } from 'react';
import { useVeil } from '../foundation/veil';
import styles from './StoryPicture.module.css';

type Props = {
  // undefined while it loads; the frame keeps its shape meanwhile.
  src: string | undefined;
  label: string;
  width: number;
  height: number;
  // In the picture's place while it is being made.
  status?: string;
  foot?: ReactNode;
};

export function StoryPicture({ src, label, width, height, status, foot }: Props) {
  const veil = useVeil();
  // A tapped veil changes only veil.revealed, which no render sees.
  const [, reveal] = useReducer((count: number) => count + 1, 0);
  const veiled = veil !== null && src !== undefined && !veil.revealed.has(src);
  return (
    <figure className={styles.picture}>
      <div className={status ? `${styles.frame} ${styles.making}` : styles.frame} style={{ '--ratio': width / height } as CSSProperties}>
        {status ? (
          <span className={styles.status}>{status}</span>
        ) : veiled ? (
          <button
            type="button"
            className={styles.veil}
            onClick={() => {
              veil.revealed.add(src);
              reveal();
            }}
          >
            이미지 보기
          </button>
        ) : (
          src && <img className={styles.image} src={src} alt={label} />
        )}
      </div>
      {foot && <figcaption className={styles.foot}>{foot}</figcaption>}
    </figure>
  );
}
