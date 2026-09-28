import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import styles from './SidePanel.module.css';

// footer: stays under the body while it scrolls, such as a summary and its action.
type Props = { title: string; subtitle?: string; actions?: ReactNode; footer?: ReactNode; onClose: () => void; children: ReactNode };

// A panel beside the page, such as 답장 정보. Where the page is too narrow for it, it covers the page.
export function SidePanel({ title, subtitle, actions, footer, onClose, children }: Props) {
  return (
    <aside className={styles.panel} aria-label={title}>
      <div className={styles.head}>
        <div className={styles.titles}>
          <h2 className={styles.title}>{title}</h2>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions}
        <IconButton icon={X} label={`${title} 닫기`} size="sm" onClick={onClose} />
      </div>
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </aside>
  );
}
