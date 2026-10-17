import { useReducer, useState, type CSSProperties, type ReactNode } from 'react';
import { useVeil } from '../foundation/veil';
import { PictureView, type Pages } from '../overlays/PictureView';
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
  pages?: Pages;
};

export function StoryPicture({ src, label, width, height, status, foot, pages }: Props) {
  const veil = useVeil();
  // A veil tapped open or shut changes only veil.revealed, which no render sees.
  const [, tapVeil] = useReducer((count: number) => count + 1, 0);
  const [open, setOpen] = useState(false);
  // A version stepped to inside the view is seen there, so it stays uncovered when the view closes.
  const veiled = veil !== null && src !== undefined && !open && !veil.revealed.has(src);
  const close = () => {
    if (veil && src) veil.revealed.add(src);
    setOpen(false);
  };
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
              tapVeil();
            }}
          >
            이미지 보기
          </button>
        ) : (
          src && (
            <>
              <button type="button" className={styles.open} aria-label={`${label} 크게 보기`} onClick={() => setOpen(true)}>
                <img className={styles.image} src={src} alt={label} />
              </button>
              {open && <PictureView src={src} label={label} ratio={width / height} pages={pages} onClose={close} />}
              {veil && (
                <button
                  type="button"
                  className={styles.cover}
                  aria-label="이미지 가리기"
                  onClick={() => {
                    veil.revealed.delete(src);
                    tapVeil();
                  }}
                >
                  가리기
                </button>
              )}
            </>
          )
        )}
      </div>
      {foot && <figcaption className={styles.foot}>{foot}</figcaption>}
    </figure>
  );
}
