import styles from './CodeCard.module.css';

export function CodeCard({ label, code }: { label: string; code: string }) {
  return (
    <div className={styles.card}>
      <span className={styles.label}>{label}</span>
      <code className={styles.code}>{code}</code>
    </div>
  );
}
