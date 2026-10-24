import { useCallback } from 'react';
import styles from './ToolFrame.module.css';

type Props = { title: string; sandbox: string; allow: string; onMount: (window: Window) => () => void };

export function ToolFrame({ title, sandbox, allow, onMount }: Props) {
  const attach = useCallback((frame: HTMLIFrameElement | null) => {
    if (frame?.contentWindow) return onMount(frame.contentWindow);
  }, [onMount]);
  return <iframe ref={attach} className={styles.frame} title={title} sandbox={sandbox} allow={allow} src="/sandbox.html?role=page" referrerPolicy="no-referrer" />;
}

type Place = (frame: HTMLIFrameElement | null) => void;

// Where a frame that already exists is shown: it is held over this box, never moved into it.
export function FrameSlot({ title, onMount }: { title: string; onMount: (place: Place) => () => void }) {
  const attach = useCallback((slot: HTMLDivElement | null) => {
    if (!slot) return;
    let placed: HTMLIFrameElement | null = null;
    const fit = () => {
      if (!placed) return;
      const box = slot.getBoundingClientRect();
      Object.assign(placed.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    };
    const place: Place = (frame) => {
      if (placed && placed !== frame) {
        placed.classList.remove(styles.placed);
        placed.hidden = true;
      }
      placed = frame;
      if (!frame) return;
      frame.title = title;
      frame.classList.add(styles.placed);
      frame.hidden = false;
      fit();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(slot);
    window.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, true);
    const detach = onMount(place);
    return () => {
      detach();
      place(null);
      observer.disconnect();
      window.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit, true);
    };
  }, [title, onMount]);
  return <div ref={attach} className={styles.slot} />;
}
