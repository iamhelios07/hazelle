import { X } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { usePanelCovers } from '../foundation/media';
import { useLayer } from '../overlays/layers';
import styles from './SidePanel.module.css';

// top: a screen's own top row (NavBar) in place of the title, for a screen opened in the panel; title still names
// the panel and its ×. page: the body scrolls back to its top when this changes, as EditorFrame's page does.
// footer: stays under the body while it scrolls, such as a summary and its action.
type Props = { title: string; subtitle?: string; top?: ReactNode; page?: string; actions?: ReactNode; footer?: ReactNode; onClose: () => void; children: ReactNode };

// A panel beside the page, such as 답장 정보. Where the page is too narrow for it, it covers the page, and there Esc or
// a press on the page closes it (user, 2026-10-02). Beside the page it stays: the page is read with it open, and Esc is
// the page's own (답장 멈추기).
export function SidePanel({ title, subtitle, top, page, actions, footer, onClose, children }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const latest = useRef(onClose);
  latest.current = onClose;
  useLayer(usePanelCovers(), {
    // A toast lies over the page too and is no part of it.
    outside: (target) => !panel.current?.contains(target) && !(target instanceof Element ? target : target.parentElement)?.closest('[role="status"], [role="alert"]'),
    // A press closes it once its click is done, and only if the panel is still there: the header button that opened
    // it closes it by itself, and another panel's button has put its own in this one's place. A press that ends as a
    // drag has no click, so the next press starts over instead of finding this one still waiting.
    close: (refocus) => {
      if (refocus) return onClose();
      const done = () => panel.current && latest.current();
      document.addEventListener('click', done, { once: true });
      document.addEventListener('pointerdown', () => document.removeEventListener('click', done), { once: true });
    },
  });
  useLayoutEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [page]);
  return (
    <aside ref={panel} className={styles.panel} aria-label={title}>
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
