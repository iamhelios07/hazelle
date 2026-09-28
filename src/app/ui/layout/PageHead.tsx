import type { ReactNode } from 'react';
import styles from './PageHead.module.css';

type Props = {
  // Left out where the screen's top row already shows it.
  title?: string;
  // A machine name under the title, such as a model id.
  code?: string;
  children?: ReactNode;
};

// The head of a page's body: the name of what it shows, its id and a lead.
export function PageHead({ title, code, children }: Props) {
  return (
    <div className={styles.head}>
      {title && <h1 className={styles.title}>{title}</h1>}
      {code && <code className={styles.code}>{code}</code>}
      {children && <p className={styles.lead}>{children}</p>}
    </div>
  );
}
