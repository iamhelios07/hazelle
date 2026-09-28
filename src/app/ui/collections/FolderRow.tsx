import type { ReactNode } from 'react';
import { Item } from './Item';
import styles from './FolderRow.module.css';

type Props = { name: string; count: number; open: boolean; onToggle: () => void; children: ReactNode };

// A folder of characters; its rows sit under it while it is open.
export function FolderRow({ name, count, open, onToggle, children }: Props) {
  return (
    <div className={styles.folder}>
      <Item density="compact" scheme="side" title={name} meta={count} expanded={open} onClick={onToggle} />
      {open && <div className={styles.folderItems}>{children}</div>}
    </div>
  );
}
