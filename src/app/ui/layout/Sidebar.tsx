import { PanelLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Brand } from '../foundation/Brand';
import { Divider } from '../foundation/Divider';
import { useLayer } from '../overlays/layers';
import styles from './Sidebar.module.css';

type Props = {
  page?: boolean;
  actions: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export function Sidebar({ page = false, actions, children, footer }: Props) {
  return (
    <aside className={page ? `${styles.sidebar} ${styles.page}` : styles.sidebar} aria-label="캐릭터 목록">
      {/* Beside the rail, whose mark is the brand, the panel starts with its own rows. */}
      {page && (
        <div className={styles.head}>
          <Brand />
        </div>
      )}
      <div className={styles.actions}>{actions}</div>
      <div className={styles.list}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </aside>
  );
}

// Esc joins the layer stack, so a menu open over the page closes first.
export function LayerSidebar({ title, onClose, search, children, footer }: { title: string; onClose: () => void; search?: ReactNode; children: ReactNode; footer: ReactNode }) {
  useLayer(true, { outside: () => false, close: onClose });
  return (
    <aside className={styles.sidebar} aria-label={title}>
      <div className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        <IconButton icon={X} label={`${title} 닫기`} size="sm" onClick={onClose} />
      </div>
      {search}
      <nav className={styles.nav} aria-label={title}>
        <div className={styles.list}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </nav>
    </aside>
  );
}

type RailProps = {
  // Only while there is a panel beside the rail to fold.
  fold?: { open: boolean; onToggle: () => void };
  actions: ReactNode;
  children: ReactNode;
};

// Every button sits above the faces, the fold last so the others stay put when it comes and goes. The mark is only the
// brand; the way home is a framed button among the actions (user ruling, 2026-10-12).
export function Rail({ fold, actions, children }: RailProps) {
  return (
    <aside className={styles.rail} aria-label="캐릭터 바로가기">
      <div className={styles.mark}>
        <Brand variant="mark" />
      </div>
      {actions}
      {fold && <IconButton icon={PanelLeft} label={fold.open ? '사이드바 접기' : '사이드바 펼치기'} framed onClick={fold.onToggle} />}
      <Divider variant="rail" />
      <div className={styles.railList}>{children}</div>
    </aside>
  );
}

type FaceButtonProps = { label: string; current?: boolean; dot?: 'accent' | 'warn'; onClick: () => void; children: ReactNode };

export function FaceButton({ label, current = false, dot, onClick, children }: FaceButtonProps) {
  return (
    <button type="button" className={current ? `${styles.faceButton} ${styles.current}` : styles.faceButton} aria-label={label} title={label} aria-current={current || undefined} onClick={onClick}>
      {children}
      {dot && <span className={`${styles.dot} ${styles[dot]}`} />}
    </button>
  );
}
