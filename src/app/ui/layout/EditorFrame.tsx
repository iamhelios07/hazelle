import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './EditorFrame.module.css';

type Props = {
  top: ReactNode;
  // An outline of what is edited, beside the part of it that is open.
  side: ReactNode;
  // The page scrolls back to its top when this changes, such as when another part is opened.
  page: string;
  children: ReactNode;
};

// A long thing edited one part at a time, such as a prompt on wide screens. Each column scrolls on its own.
export function EditorFrame({ top, side, page, children }: Props) {
  const main = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [page]);
  return (
    <main className={styles.frame}>
      <header className={styles.top}>{top}</header>
      <div className={styles.body}>
        <nav className={styles.side} aria-label="개요">
          {side}
        </nav>
        <div ref={main} className={styles.main}>
          <div className={styles.page}>{children}</div>
        </div>
      </div>
    </main>
  );
}
