import { ChevronRight } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './PathBar.module.css';

export type PathPart = { key: string; name: string; onClick: () => void };

// Where a list stands, from the top down; every part but the last goes there.
export function PathBar({ label, parts }: { label: string; parts: PathPart[] }) {
  return (
    <nav aria-label={label}>
      <ol className={styles.path}>
        {parts.map((part, index) => (
          <li key={part.key} className={styles.part}>
            {index > 0 && <Icon icon={ChevronRight} size="sm" />}
            {index === parts.length - 1 ? (
              <span className={styles.here} aria-current="location">{part.name}</span>
            ) : (
              <button type="button" className={styles.up} onClick={part.onClick}>{part.name}</button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
