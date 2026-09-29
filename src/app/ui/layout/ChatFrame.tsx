import { ChevronDown, ChevronLeft } from 'lucide-react';
import type { CSSProperties, ReactNode, Ref, RefObject } from 'react';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../foundation/Icon';
import styles from './ChatFrame.module.css';

type Spacing = 'narrow' | 'normal' | 'wide';

// How the story reads (design F3, 읽기 설정). tokens.css holds each choice's look.
export type Reading = { font: 'serif' | 'sans'; size: number; leading: Spacing; width: Spacing };

// The look before any reading setting. The size is read from tokens.css, not repeated here, since Prose keeps it
// outside the chat.
export const readingDefault = (): Reading => ({
  font: 'serif',
  size: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--prose-size')),
  leading: 'normal',
  width: 'normal',
});

const LEADING: Record<Spacing, string> = { narrow: styles.leadingNarrow, normal: styles.leadingNormal, wide: styles.leadingWide };
const WIDTH: Record<Spacing, string> = { narrow: styles.widthNarrow, normal: styles.widthNormal, wide: styles.widthWide };

type Props = {
  back?: { label: string; onClick: () => void };
  title: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  // Floats above the composer: the 새 답장 pill and toasts.
  above: ReactNode;
  footer: ReactNode;
  panel?: ReactNode;
  reading: Reading;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
};

// The chat page: a header, the story column that scrolls, the composer, and the 정보 panel beside it.
export function ChatFrame({ back, title, actions, children, above, footer, panel, reading, scrollRef, onScroll }: Props) {
  return (
    <div className={styles.frame}>
      <main
        className={`${styles.column} ${styles[reading.font]} ${LEADING[reading.leading]} ${WIDTH[reading.width]}`}
        style={{ '--reading-size': `${reading.size}px` } as CSSProperties}
      >
        <header className={styles.header}>
          {back && <IconButton icon={ChevronLeft} label={back.label} onClick={back.onClick} />}
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

type TitleProps = {
  avatar: ReactNode;
  title: string;
  typing: boolean;
  // The name opens the menu of the chats it sits among (design F3), and takes these from Menu.
  popup: 'menu' | 'dialog';
  expanded: boolean;
  ref: Ref<HTMLButtonElement>;
  onClick: () => void;
};

// The chat's name in its header, with 쓰는 중 while a reply is being written.
export function ChatTitle({ avatar, title, typing, popup, expanded, ref, onClick }: TitleProps) {
  return (
    <span className={styles.chatTitle}>
      {avatar}
      <h1 className={styles.heading}>
        <button ref={ref} type="button" className={styles.switch} aria-haspopup={popup} aria-expanded={expanded} onClick={onClick}>
          <span className={styles.name}>{title}</span>
          <Icon icon={ChevronDown} size="xs" />
        </button>
      </h1>
      {typing && (
        <span className={styles.typing}>
          <span className={styles.pulse} />
          쓰는 중
        </span>
      )}
    </span>
  );
}
