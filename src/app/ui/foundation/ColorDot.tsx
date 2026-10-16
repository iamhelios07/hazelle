import styles from './ColorDot.module.css';

export function ColorDot({ pick, value }: { pick: 'bg' | 'ink' | 'accent' | 'dialogue'; value: string }) {
  return <span className={`${styles.dot} ${styles[pick]}`} {...{ [`data-${pick}`]: value }} aria-hidden />;
}
