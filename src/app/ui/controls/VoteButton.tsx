import { ThumbsUp } from 'lucide-react';
import styles from './VoteButton.module.css';

type Props = {
  // What the button is named by, the count in it (such as 추천 6).
  label: string;
  count: string;
  pressed: boolean;
  // column: a feed's column beside a post; row: under a post read whole.
  layout?: 'column' | 'row';
  onClick: () => void;
};

// A 추천 that one account gives or takes back, its count inside.
export function VoteButton({ label, count, pressed, layout = 'row', onClick }: Props) {
  return (
    <button type="button" className={`${styles.vote} ${styles[layout]}`} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <ThumbsUp className={styles.icon} aria-hidden />
      <span className={styles.count}>{count}</span>
    </button>
  );
}
