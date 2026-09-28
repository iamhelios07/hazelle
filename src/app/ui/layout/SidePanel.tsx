import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import styles from './SidePanel.module.css';

type Props = { title: string; subtitle?: string; actions?: ReactNode; onClose: () => void; children: ReactNode };

// A panel beside the page, such as 답장 정보. Where the page is too narrow for it, it covers the page.
export function SidePanel({ title, subtitle, actions, onClose, children }: Props) {
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
    </aside>
  );
}

// One titled part of a panel.
export function PanelSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {note && <span className={styles.note}>{note}</span>}
      </div>
      {children}
    </section>
  );
}
