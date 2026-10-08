import { ChevronLeft } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { IconButton } from '../controls/IconButton';
import styles from './ChatFrame.module.css';

type Spacing = 'narrow' | 'normal' | 'wide';

// How the story reads (읽기 설정). tokens.css holds each look; reply is how the view meets a reply (useFollow).
export type Reading = { font: 'serif' | 'sans'; size: number; leading: Spacing; width: Spacing; reply: 'follow' | 'stay' };

// The look before any reading setting. The size is read from tokens.css, not repeated here, since Story keeps it
// outside the chat.
export const readingDefault = (): Reading => ({
  font: 'serif',
  size: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--prose-size')),
  leading: 'normal',
  width: 'normal',
  reply: 'follow',
});

const LEADING: Record<Spacing, string> = { narrow: styles.leadingNarrow, normal: styles.leadingNormal, wide: styles.leadingWide };
const WIDTH: Record<Spacing, string> = { narrow: styles.widthNarrow, normal: styles.widthNormal, wide: styles.widthWide };

// The reading settings on the element a story sits in: the chat's column, or an exported log (LogExport).
export const readingScope = ({ font, size, leading, width }: Reading) => ({ className: `${styles[font]} ${LEADING[leading]} ${WIDTH[width]}`, style: { '--reading-size': `${size}px` } as CSSProperties });

type Props = {
  back?: { label: string; onClick: () => void };
  title: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  above: ReactNode;
  footer: ReactNode;
  panel?: ReactNode;
  peek?: ReactNode;
  aside?: ReactNode;
  reading: Reading;
  hideHeader: boolean;
  // A character's own look for the lines that are only a picture, over the defaults in tokens.css.
  pictures?: { fold?: false; peek?: number; most?: number };
  compact: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
};

export function ChatFrame({ back, title, actions, children, above, footer, panel, peek, aside, reading, hideHeader, pictures, compact, scrollRef, onScroll }: Props) {
  const scope = readingScope(reading);
  const [shown, setShown] = useState(true);
  const lastTop = useRef(0);
  const footerRef = useRef<HTMLDivElement>(null);
  // The story ends above the composer as it is whole, never folded or midway: space that moved with the fold would
  // move the story's end, and the view with it. Only a transition is skipped, so a spinner in the composer does not
  // stop the measuring.
  const [space, setSpace] = useState(0);
  const [scrollbar, setScrollbar] = useState(0);

  useLayoutEffect(() => {
    const element = footerRef.current!;
    const measure = () => {
      if (element.matches(`.${styles.compact}:not(:focus-within)`)) return;
      if (element.getAnimations({ subtree: true }).some((animation) => animation instanceof CSSTransition)) return;
      setSpace(element.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('transitionend', measure);
    element.addEventListener('transitioncancel', measure);
    return () => {
      observer.disconnect();
      element.removeEventListener('transitionend', measure);
      element.removeEventListener('transitioncancel', measure);
    };
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current!;
    const measure = () => setScrollbar(element.offsetWidth - element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef]);

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
        className={`${styles.column} ${scope.className}`}
        style={
          {
            ...scope.style,
            '--footer-space': `${space}px`,
            '--story-scrollbar': `${scrollbar}px`,
            '--story-picture-peek': pictures?.fold === false ? 'none' : pictures?.peek && `${pictures.peek}vh`,
            '--story-picture-most': pictures?.most && `${pictures.most}vh`,
          } as CSSProperties
        }
      >
        <div className={`${styles.top} ${shown || !hideHeader ? styles.shown : ''}`}>
          <header className={styles.header}>
            {back && <IconButton icon={ChevronLeft} label={back.label} onClick={back.onClick} />}
            <div className={styles.title}>{title}</div>
            <div className={styles.actions}>{actions}</div>
          </header>
        </div>
        <div className={styles.scroll} ref={scrollRef} onScroll={scrolled}>
          <div className={styles.content}>
            {children}
          </div>
        </div>
        {aside}
        {peek}
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
  name: string;
  sub?: string;
  typing: boolean;
  onClick?: () => void;
};

export function ChatTitle({ name, sub, typing, onClick }: TitleProps) {
  const lines = (
    <span className={styles.lines}>
      <span className={styles.name}>{name}</span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </span>
  );
  return (
    <span className={styles.chatTitle}>
      <h1 className={styles.heading}>
        {onClick ? (
          <button type="button" className={`${styles.box} ${styles.press}`} onClick={onClick}>
            {lines}
          </button>
        ) : (
          <span className={styles.box}>{lines}</span>
        )}
      </h1>
      {typing && (
        <span className={styles.typing}>
          <span className={styles.pulse} />
          생성 중
        </span>
      )}
    </span>
  );
}
