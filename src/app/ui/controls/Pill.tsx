import styles from './Pill.module.css';

export function Pill({ label, live, onClick }: { label: string; live: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.pill} onClick={onClick}>
      {live && <span className={styles.live} />}
      {label}
    </button>
  );
}
