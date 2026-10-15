import { ChevronRight } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { useCardDrop } from './cardDrag';
import styles from './PathBar.module.css';

// onDropCard: a dragged FaceCard's key, let go over this part.
export type PathPart = { key: string; name: string; onClick: () => void; onDropCard?: (key: string) => void };

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
              <Up part={part} />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Up({ part }: { part: PathPart }) {
  const drop = useCardDrop(part.onDropCard);
  return <button type="button" className={drop.over ? `${styles.up} ${styles.dropping}` : styles.up} onClick={part.onClick} {...drop.props}>{part.name}</button>;
}
