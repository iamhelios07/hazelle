import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './PostCard.module.css';

// A feed of posts, each a card of its own.
export function PostFeed({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.feed} aria-label={label}>
      {children}
    </ul>
  );
}

type Props = {
  title: string;
  // The start of its text, cut at two lines.
  excerpt?: string | null;
  // Tags over the title: what kind of post it is and where it stands.
  marks?: ReactNode;
  byline: ReactNode;
  // Counts at the foot's end, such as its comments.
  stats?: ReactNode;
  // A VoteButton in the column before it, pressed without opening the post.
  vote?: ReactNode;
  // muted: a placeholder for a post its author deleted.
  tone?: 'plain' | 'muted';
  onClick: () => void;
};

export function PostCard({ title, excerpt, marks, byline, stats, vote, tone = 'plain', onClick }: Props) {
  return (
    <li className={tone === 'muted' ? `${styles.card} ${styles.muted}` : styles.card}>
      {vote && <div className={styles.vote}>{vote}</div>}
      <div className={styles.main}>
        {marks && <div className={styles.marks}>{marks}</div>}
        <h3 className={styles.title}>
          {/* The title's button covers the whole card (::after); the vote stands above it. */}
          <button type="button" className={styles.open} onClick={onClick}>
            {title}
          </button>
        </h3>
        {excerpt && <p className={styles.excerpt}>{excerpt}</p>}
        <div className={styles.foot}>
          {byline}
          {stats && <span className={styles.stats}>{stats}</span>}
        </div>
      </div>
    </li>
  );
}

// A count beside its icon, at a card's foot.
export function PostStat({ icon, label, count }: { icon: LucideIcon; label: string; count: string }) {
  return (
    <span className={styles.stat} aria-label={`${label} ${count}`}>
      <Icon icon={icon} size="xs" />
      {count}
    </span>
  );
}
