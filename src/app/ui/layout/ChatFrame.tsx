import { ChevronDown, ChevronLeft } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref, type RefObject } from 'react';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../foundation/Icon';
import styles from './ChatFrame.module.css';

type Spacing = 'narrow' | 'normal' | 'wide';

// How the story reads (읽기 설정). tokens.css holds each choice's look.
export type Reading = { font: 'serif' | 'sans'; size: number; leading: Spacing; width: Spacing };

// The look before any reading setting. The size is read from tokens.css, not repeated here, since Story keeps it
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
  // Floats above the composer: the 새 답장 pill.
  above: ReactNode;
  // Floats under the header, apart from the pill: toasts.
  notice: ReactNode;
  footer: ReactNode;
  panel?: ReactNode;
  reading: Reading;
  // The story is read above its end: the composer folds to one line (Composer's compact).
  compact: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
};

// The chat page: a header, the story column that scrolls, the composer, and the 정보 panel beside it. The header and
// the composer float over the story: the header hides while the story is read down, and comes back when it is scrolled
// up, reached at its top or pointed at the page's top edge.
export function ChatFrame({ back, title, actions, children, above, notice, footer, panel, reading, compact, scrollRef, onScroll }: Props) {
  const [shown, setShown] = useState(true);
  const lastTop = useRef(0);
  const footerRef = useRef<HTMLDivElement>(null);
  const folded = useRef(compact);
  // The story ends above the composer as it is whole, folded or not: space that shrank with the fold would move the
  // story's end, which would unfold it again at once.
  const [space, setSpace] = useState(0);

  useLayoutEffect(() => {
    folded.current = compact;
  });

  useLayoutEffect(() => {
    const element = footerRef.current!;
    const measure = () => {
      if (!folded.current || element.matches(':focus-within')) setSpace(element.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A move that ends at the story's end is the view following it (the story shrank as its font loaded, a reply
  // grew), not the reader going up.
  function scrolled() {
    const element = scrollRef.current!;
    const top = element.scrollTop;
    const end = element.scrollHeight - top - element.clientHeight < 1;
    if (top !== lastTop.current) setShown(top === 0 || (top < lastTop.current && !end));
    lastTop.current = top;
    onScroll();
  }

  return (
    <div className={styles.frame}>
      <main
        className={`${styles.column} ${styles[reading.font]} ${LEADING[reading.leading]} ${WIDTH[reading.width]}`}
        style={{ '--reading-size': `${reading.size}px`, '--footer-space': `${space}px` } as CSSProperties}
      >
        <div className={`${styles.top} ${shown ? styles.shown : ''}`}>
          <header className={styles.header}>
            {back && <IconButton icon={ChevronLeft} label={back.label} onClick={back.onClick} />}
            <div className={styles.title}>{title}</div>
            <div className={styles.actions}>{actions}</div>
          </header>
        </div>
        <div className={styles.notice}>{notice}</div>
        <div className={styles.scroll} ref={scrollRef} onScroll={scrolled}>
          <div className={styles.content}>{children}</div>
        </div>
        <div ref={footerRef} className={`${styles.footer} ${compact ? styles.compact : ''}`}>
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
  // The name opens the menu of the chats it sits among, and takes these from Menu.
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
