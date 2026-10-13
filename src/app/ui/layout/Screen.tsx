import type { FormEvent, ReactNode } from 'react';
import { usePane } from './ListDetail';
import styles from './Screen.module.css';

type Props = {
  top?: ReactNode;
  align?: 'start' | 'center';
  // page: 설정's pages, which use the column beside the settings sidebar.
  width?: 'narrow' | 'form' | 'wide' | 'page';
  actions?: ReactNode;
  stickyActions?: boolean;
  // One child takes the rest of the window's height and scrolls itself.
  fill?: boolean;
  // A column beside the body once the screen is wide enough for both; above the body when it is not.
  aside?: ReactNode;
  // The aside previews the body: it stands only beside it, left out when stacked, and stays in view as the body scrolls.
  preview?: boolean;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

export function Screen({ top, align = 'start', width = 'narrow', actions, stickyActions = false, fill = false, aside, preview = false, onSubmit, children }: Props) {
  const pane = usePane();
  // A page has one main landmark; beside a list, a screen is one section of it.
  const Root = pane ? 'section' : 'main';
  const content = align === 'center' ? `${styles.content} ${styles.center}` : styles.content;
  const inner = (
    <>
      {aside ? (
        <div className={styles.columns}>
          <div className={preview ? `${styles.aside} ${styles.preview}` : styles.aside}>{aside}</div>
          <div className={styles.body}>{children}</div>
        </div>
      ) : (
        <div className={styles.body}>{children}</div>
      )}
      {actions && <div className={stickyActions ? `${styles.actions} ${styles.sticky}` : styles.actions}>{actions}</div>}
    </>
  );
  return (
    <Root className={[styles.screen, pane && styles.pane, fill && styles.fill, align === 'center' && styles.centered, width !== 'narrow' && styles[width], aside && styles.split].filter(Boolean).join(' ')}>
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
