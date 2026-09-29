import styles from './CodeBlock.module.css';

// Text as a program sent or read it, such as a request's address or body: its lines kept, long ones wrapped.
export function CodeBlock({ children }: { children: string }) {
  return <pre className={styles.block}>{children}</pre>;
}
