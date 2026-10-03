import styles from './CodeBlock.module.css';

export function CodeBlock({ variant = 'code', children }: { variant?: 'code' | 'prose'; children: string }) {
  return <pre className={`${styles.block} ${styles[variant]}`}>{children}</pre>;
}
