import styles from './Kbd.module.css';

export function Kbd({ children }: { children: string }) {
  return <kbd className={styles.key}>{children}</kbd>;
}
