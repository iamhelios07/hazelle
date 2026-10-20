import type { FormEvent, ReactNode } from 'react';
import { usePane } from './ListDetail';
import styles from './Screen.module.css';

type Props = {
  top?: ReactNode;
  align?: 'start' | 'center';
  // page: 설정's pages, which use the column beside the settings sidebar.
  width?: 'narrow' | 'form' | 'wide' | 'page';
  actions?: ReactNode;
  // One child takes the rest of the window's height and scrolls itself.
  fill?: boolean;
  // A column beside the body once the screen is wide enough for both; above the body when it is not.
  aside?: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

// Screen's aside and Beside's preview are this one grid; sticky, the column stays in view as the body scrolls.
export function AsideColumns({ aside, sticky = false, children }: { aside: ReactNode; sticky?: boolean; children: ReactNode }) {
  // A container query measures an ancestor, never the element it styles: the frame is what the columns measure.
  return (
    <div className={styles.frame}>
      <div className={styles.columns}>
        <div className={sticky ? `${styles.aside} ${styles.sticky}` : styles.aside}>{aside}</div>
        <div className={styles.main}>{children}</div>
      </div>
    </div>
  );
}

export function Screen({ top, align = 'start', width = 'narrow', actions, fill = false, aside, onSubmit, children }: Props) {
  const pane = usePane();
  // A page has one main landmark; beside a list, a screen is one section of it.
  const Root = pane ? 'section' : 'main';
  const content = align === 'center' ? `${styles.content} ${styles.center}` : styles.content;
  const body = <div className={styles.body}>{children}</div>;
  const inner = (
    <>
      {aside ? <AsideColumns aside={aside}>{body}</AsideColumns> : body}
      {actions && <div className={styles.actions}>{actions}</div>}
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
