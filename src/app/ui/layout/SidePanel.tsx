import { Maximize2, Minimize2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { usePanelCovers } from '../foundation/media';
import { useLayer } from '../overlays/layers';
import styles from './SidePanel.module.css';

// page: the body scrolls back to its top when this changes, as EditorFrame's page does. expandable: beside the page it
// can widen over the whole page, which stays under it as it was.
type Props = { title: string; subtitle?: string; top?: ReactNode; page?: string; actions?: ReactNode; footer?: ReactNode; expandable?: boolean; onClose: () => void; children: ReactNode };

// Where the page is too narrow for it, it covers the page, and there Esc or a press on the page closes it (user,
// 2026-10-02). Beside the page it stays: the page is read with it open, and Esc is the page's own (응답 멈추기).
export function SidePanel({ title, subtitle, top, page, actions, footer, expandable = false, onClose, children }: Props) {
  const covers = usePanelCovers();
  const [expanded, setExpanded] = useState(false);
  const widens = expandable && !covers;
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const latest = useRef(onClose);
  latest.current = onClose;
  useLayer(covers, {
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
    <aside ref={panel} className={widens && expanded ? `${styles.panel} ${styles.expanded}` : styles.panel} aria-label={title}>
      <div className={top ? `${styles.head} ${styles.screen}` : styles.head}>
        {top ?? (
          <div className={styles.titles}>
            <h2 className={styles.title}>{title}</h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        )}
        {actions}
        {widens && <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? '좁게 보기' : '넓게 보기'} size="sm" onClick={() => setExpanded(!expanded)} />}
        <IconButton icon={X} label={`${title} 닫기`} size="sm" onClick={onClose} />
      </div>
      <div ref={body} className={styles.body}>
        {children}
      </div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </aside>
  );
}
