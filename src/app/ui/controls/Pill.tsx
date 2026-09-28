import styles from './Pill.module.css';

// A floating button over the story, such as 새 답장 when the view is scrolled up.
export function Pill({ label, live, onClick }: { label: string; live: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.pill} onClick={onClick}>
      {live && <span className={styles.live} />}
      {label}
    </button>
  );
}
