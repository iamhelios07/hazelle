import type { ReactNode } from 'react';
import { Item } from './Item';
import styles from './FolderRow.module.css';

type Props = { name: string; count: number; open: boolean; onToggle: () => void };

// A folder of characters; its rows sit under it while it is open.
export function FolderRow({ name, count, open, onToggle }: Props) {
  return <Item density="compact" scheme="side" title={name} meta={count} expanded={open} onClick={onToggle} />;
}

export function TreeRow({ depth, children }: { depth: number; children: ReactNode }) {
  let row = children;
  for (let i = 0; i < depth; i++) row = <div className={styles.folderItems}>{row}</div>;
  return <div className={styles.folder}>{row}</div>;
}
