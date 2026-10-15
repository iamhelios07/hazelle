import { Info } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../foundation/Icon';
import { useHover } from '../foundation/media';
import { keepOnScreen, useLayer } from './layers';
import styles from './Hint.module.css';

// Long enough that a pointer passing over a column of ⓘ opens none of them.
const PEEK_DELAY = 300;

export function Hint({ label, children }: { label: string; children: string }) {
  const hover = useHover();
  const [state, setState] = useState<'closed' | 'peek' | 'pinned'>('closed');
  const timer = useRef(0);
  const box = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const id = useId();

  useLayer(state === 'pinned', {
    outside: (target) => !box.current?.contains(target) && !bubble.current?.contains(target),
    close: (refocus) => {
      setState('closed');
      if (refocus) box.current?.querySelector('button')?.focus();
    },
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The bubble lives on the body at a fixed spot under the ⓘ, so a dialog's or panel's scrolling box cannot clip it.
  // It does not follow a scroll, so any scroll closes it.
  useLayoutEffect(() => {
    const element = bubble.current;
    const anchor = box.current;
    if (!element || !anchor) return;
    const at = anchor.getBoundingClientRect();
    element.style.setProperty('--hint-left', `${at.left}px`);
    element.style.setProperty('--hint-top', `${at.bottom}px`);
    element.style.setProperty('--hint-bottom', `${window.innerHeight - at.top}px`);
    keepOnScreen(element);
    delete element.dataset.above;
    if (element.getBoundingClientRect().bottom > window.innerHeight) element.dataset.above = '';
  }, [state]);
  useEffect(() => {
    if (state === 'closed') return;
    const close = () => setState('closed');
    window.addEventListener('scroll', close, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', close, { capture: true });
  }, [state]);

  const peek = () => {
    timer.current = window.setTimeout(() => setState((now) => (now === 'closed' ? 'peek' : now)), PEEK_DELAY);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    setState((now) => (now === 'peek' ? 'closed' : now));
  };

  return (
    <span ref={box} className={styles.hint} onPointerEnter={hover ? peek : undefined} onPointerLeave={hover ? leave : undefined}>
      <button
        type="button"
        className={styles.button}
        aria-label={`${label} 설명`}
        aria-expanded={state !== 'closed'}
        aria-controls={id}
        onClick={() => {
          window.clearTimeout(timer.current);
          setState((now) => (now === 'pinned' ? 'closed' : 'pinned'));
        }}
      >
        <Icon icon={Info} size="xs" />
      </button>
      {state !== 'closed' &&
        createPortal(
          <span ref={bubble} id={id} role="note" className={styles.bubble}>
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
