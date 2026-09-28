import { PanelLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { IconButton } from './IconButton';
import styles from './Sidebar.module.css';

type Props = {
  // On phones the chat list is the home screen and fills it.
  page?: boolean;
  onCollapse?: () => void;
  actions: ReactNode;
  children: ReactNode;
  footer: ReactNode;
};

export function Sidebar({ page = false, onCollapse, actions, children, footer }: Props) {
  return (
    <aside className={page ? `${styles.sidebar} ${styles.page}` : styles.sidebar} aria-label="채팅 목록">
      <div className={styles.head}>
        <Brand />
        {onCollapse && <IconButton icon={PanelLeft} label="사이드바 접기" size="sm" onClick={onCollapse} />}
      </div>
      <div className={styles.actions}>{actions}</div>
      <div className={styles.list}>{children}</div>
      <div className={styles.footer}>{footer}</div>
    </aside>
  );
}

// The collapsed sidebar: one icon per chat and per place.
export function Rail({ onExpand, actions, children, footer }: { onExpand: () => void; actions: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <aside className={styles.rail} aria-label="채팅 목록">
      <IconButton icon={PanelLeft} label="사이드바 펼치기" onClick={onExpand} />
      {actions}
      <span className={styles.rule} />
      <div className={styles.railList}>{children}</div>
      {footer}
    </aside>
  );
}

type RailItemProps = { label: string; current?: boolean; dot?: 'accent' | 'warn'; onClick: () => void; children: ReactNode };

export function RailItem({ label, current = false, dot, onClick, children }: RailItemProps) {
  return (
    <button type="button" className={current ? `${styles.railItem} ${styles.current}` : styles.railItem} aria-label={label} title={label} aria-current={current || undefined} onClick={onClick}>
      {children}
      {dot && <span className={`${styles.dot} ${styles[dot]}`} />}
    </button>
  );
}
