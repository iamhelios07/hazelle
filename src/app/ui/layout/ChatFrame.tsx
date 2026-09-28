import { ChevronLeft } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { IconButton } from '../controls/IconButton';
import styles from './ChatFrame.module.css';

type Props = {
  // Phones only: back to the chat list.
  onBack?: () => void;
  title: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  // Floats above the composer: the 새 답장 pill and toasts.
  above: ReactNode;
  footer: ReactNode;
  panel?: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
};

// The chat page: a header, the story column that scrolls, the composer, and the 정보 panel beside it.
export function ChatFrame({ onBack, title, actions, children, above, footer, panel, scrollRef, onScroll }: Props) {
  return (
    <div className={styles.frame}>
      <main className={styles.column}>
        <header className={styles.header}>
          {onBack && <IconButton icon={ChevronLeft} label="채팅 목록" onClick={onBack} />}
          <div className={styles.title}>{title}</div>
          <div className={styles.actions}>{actions}</div>
        </header>
        <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
          <div className={styles.content}>{children}</div>
        </div>
        <div className={styles.footer}>
          <div className={styles.above}>{above}</div>
          <div className={styles.dock}>{footer}</div>
        </div>
      </main>
      {panel}
    </div>
  );
}

// The chat's name in its header, with 쓰는 중 while a reply is being written.
export function ChatTitle({ avatar, title, typing }: { avatar: ReactNode; title: string; typing: boolean }) {
  return (
    <span className={styles.chatTitle}>
      {avatar}
      <h1 className={styles.name}>{title}</h1>
      {typing && (
        <span className={styles.typing}>
          <span className={styles.pulse} />
          쓰는 중
        </span>
      )}
    </span>
  );
}
