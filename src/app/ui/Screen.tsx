import type { FormEvent, ReactNode } from 'react';
import styles from './Screen.module.css';

type Props = {
  top?: ReactNode;
  align?: 'start' | 'center';
  actions?: ReactNode;
  // Keeps the actions in view at the bottom while a long body scrolls, such as a model list.
  stickyActions?: boolean;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

// The page frame: a top row, the body, and actions that sit at the bottom on phones. With onSubmit,
// body and actions become one form, so a submit button can live in the actions slot. align="center"
// centers the body vertically, for screens without actions such as the empty home.
export function Screen({ top, align = 'start', actions, stickyActions = false, onSubmit, children }: Props) {
  const content = align === 'center' ? `${styles.content} ${styles.center}` : styles.content;
  const inner = (
    <>
      <div className={styles.body}>{children}</div>
      {actions && <div className={stickyActions ? `${styles.actions} ${styles.sticky}` : styles.actions}>{actions}</div>}
    </>
  );
  return (
    <main className={styles.screen}>
      {top && <header className={styles.top}>{top}</header>}
      {onSubmit ? (
        <form className={content} onSubmit={onSubmit} noValidate>
          {inner}
        </form>
      ) : (
        <div className={content}>{inner}</div>
      )}
    </main>
  );
}
