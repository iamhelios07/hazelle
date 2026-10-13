import styles from './ColorDot.module.css';

// A color pick of 설정 › 디스플레이 (theme.ts BG, INK, ACCENT) as the current theme draws it (tokens.css [data-bg] and the rest).
export function ColorDot({ pick, value }: { pick: 'bg' | 'ink' | 'accent'; value: string }) {
  return <span className={`${styles.dot} ${styles[pick]}`} {...{ [`data-${pick}`]: value }} aria-hidden />;
}
