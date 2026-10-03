import type { FormEvent, ReactNode } from 'react';
import { usePane } from './ListDetail';
import styles from './Screen.module.css';

type Props = {
  top?: ReactNode;
  align?: 'start' | 'center';
  width?: 'narrow' | 'form' | 'wide';
  actions?: ReactNode;
  stickyActions?: boolean;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

export function Screen({ top, align = 'start', width = 'narrow', actions, stickyActions = false, onSubmit, children }: Props) {
  const pane = usePane();
  // A page has one main landmark; beside a list, a screen is one section of it.
  const Root = pane ? 'section' : 'main';
  const content = align === 'center' ? `${styles.content} ${styles.center}` : styles.content;
  const inner = (
    <>
      <div className={styles.body}>{children}</div>
      {actions && <div className={stickyActions ? `${styles.actions} ${styles.sticky}` : styles.actions}>{actions}</div>}
    </>
  );
  return (
    <Root className={[styles.screen, pane && styles.pane, width !== 'narrow' && styles[width]].filter(Boolean).join(' ')}>
      {top && <header className={styles.top}>{top}</header>}
      {onSubmit ? (
        <form className={content} onSubmit={onSubmit} noValidate>
          {inner}
        </form>
      ) : (
        <div className={content}>{inner}</div>
      )}
    </Root>
  );
}
