import { Info } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../foundation/Icon';
import { useHover } from '../foundation/media';
import { useLayer } from './layers';
import styles from './Hint.module.css';

// Long enough that a pointer passing over a column of ⓘ opens none of them.
const PEEK_DELAY = 300;

// An explanation behind an ⓘ beside a label, so the label leads and the reader who needs it asks for it
// (user, 2026-09-29). Where there is hover, resting on it shows it until the pointer leaves; a click or tap
// pins it until Esc, a press outside or another click.
export function Hint({ label, children }: { label: string; children: string }) {
  const hover = useHover();
  const [state, setState] = useState<'closed' | 'peek' | 'pinned'>('closed');
  const timer = useRef(0);
  const box = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const id = useId();

  useLayer(state === 'pinned', {
    outside: (target) => !box.current?.contains(target),
    close: (refocus) => {
      setState('closed');
      if (refocus) box.current?.querySelector('button')?.focus();
    },
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Moved back inside the screen's side before it is painted, as a menu is.
  useLayoutEffect(() => {
    const element = bubble.current;
    if (!element) return;
    const at = element.getBoundingClientRect();
    const edge = parseFloat(getComputedStyle(element).getPropertyValue('--menu-edge'));
    const room = document.documentElement.clientWidth;
    const shift = at.left < edge ? edge - at.left : at.right > room - edge ? room - edge - at.right : 0;
    element.style.setProperty('--nudge', `${shift}px`);
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
      {state !== 'closed' && (
        <span ref={bubble} id={id} role="note" className={styles.bubble}>
          {children}
        </span>
      )}
    </span>
  );
}
