import type { FormEvent, ReactNode } from 'react';
import styles from './Screen.module.css';

type Props = {
  top?: ReactNode;
  actions?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

// The page frame: a top row, the body, and actions that sit at the bottom on phones. With onSubmit,
// body and actions become one form, so a submit button can live in the actions slot.
export function Screen({ top, actions, onSubmit, children }: Props) {
  const inner = (
    <>
      <div className={styles.body}>{children}</div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </>
  );
  return (
    <main className={styles.screen}>
      {top && <header className={styles.top}>{top}</header>}
      {onSubmit ? (
        <form className={styles.content} onSubmit={onSubmit} noValidate>
          {inner}
        </form>
      ) : (
        <div className={styles.content}>{inner}</div>
      )}
    </main>
  );
}
