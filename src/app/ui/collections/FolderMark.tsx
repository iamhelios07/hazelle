import { Folder } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './FolderMark.module.css';

// A folder's row is told from its things' rows by this filled mark, the same in every list.
export function FolderMark({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={styles.mark}>
      <Icon icon={Folder} size={size} />
    </span>
  );
}
