import { X } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import styles from './SidePanel.module.css';

// top: a screen's own top row (NavBar) in place of the title, for a screen opened in the panel; title still names
// the panel and its ×. page: the body scrolls back to its top when this changes, as EditorFrame's page does.
// footer: stays under the body while it scrolls, such as a summary and its action.
type Props = { title: string; subtitle?: string; top?: ReactNode; page?: string; actions?: ReactNode; footer?: ReactNode; onClose: () => void; children: ReactNode };

// A panel beside the page, such as 답장 정보. Where the page is too narrow for it, it covers the page.
export function SidePanel({ title, subtitle, top, page, actions, footer, onClose, children }: Props) {
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [page]);
  return (
    <aside className={styles.panel} aria-label={title}>
      <div className={top ? `${styles.head} ${styles.screen}` : styles.head}>
        {top ?? (
          <div className={styles.titles}>
            <h2 className={styles.title}>{title}</h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        )}
        {actions}
        <IconButton icon={X} label={`${title} 닫기`} size="sm" onClick={onClose} />
      </div>
      <div ref={body} className={styles.body}>
        {children}
      </div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </aside>
  );
}
