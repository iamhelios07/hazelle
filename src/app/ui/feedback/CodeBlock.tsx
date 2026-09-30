import styles from './CodeBlock.module.css';

// Text as a program sent or read it, such as a request's address or body: its lines kept, long ones wrapped. prose: in
// the body's letters, for text a person reads, such as what an example of a prompt gives.
export function CodeBlock({ variant = 'code', children }: { variant?: 'code' | 'prose'; children: string }) {
  return <pre className={`${styles.block} ${styles[variant]}`}>{children}</pre>;
}
