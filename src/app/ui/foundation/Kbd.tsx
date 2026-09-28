import styles from './Kbd.module.css';

// One key cap.
export function Kbd({ children }: { children: string }) {
  return <kbd className={styles.key}>{children}</kbd>;
}
