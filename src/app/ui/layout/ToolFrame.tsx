import { useCallback } from 'react';
import styles from './ToolFrame.module.css';

type Props = { title: string; size: 'page' | 'panel'; onMount: (window: Window) => () => void };

export function ToolFrame({ title, size, onMount }: Props) {
  const attach = useCallback((frame: HTMLIFrameElement | null) => {
    if (frame?.contentWindow) return onMount(frame.contentWindow);
  }, [onMount]);
  return <iframe ref={attach} className={styles.frame} data-size={size} title={title} sandbox="allow-scripts" src="/sandbox.html?role=page" referrerPolicy="no-referrer" />;
}
