import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './SideRow.module.css';

type Props = { name: string; count: number; open: boolean; onToggle: () => void; children: ReactNode };

// A folder of characters; its rows sit under it while it is open.
export function FolderRow({ name, count, open, onToggle, children }: Props) {
  return (
    <div className={styles.folder}>
      <button type="button" className={styles.folderHead} aria-expanded={open} onClick={onToggle}>
        <Icon icon={open ? ChevronDown : ChevronRight} size="xs" />
        <span className={styles.label}>{name}</span>
        <span className={styles.count}>{count}</span>
      </button>
      {open && <div className={styles.folderItems}>{children}</div>}
    </div>
  );
}
