import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { isComposing } from '../foundation/keys';

type Layer = {
  outside: (target: Node) => boolean;
  // refocus: closed by Esc, so the focus goes back to where the layer was opened. A press outside leaves the
  // focus where it pressed.
  close: (refocus: boolean) => void;
};

// Every open menu and dialog, newest last. Esc and a press outside reach the newest one only, so Esc in a menu
// over a dialog closes the menu and leaves the dialog open. These are the kit's only document listeners for keys
// and presses: a component adding its own would reach every layer again.
const open: Layer[] = [];

function press(event: PointerEvent) {
  const top = open.at(-1);
  if (top?.outside(event.target as Node)) top.close(false);
}

function key(event: KeyboardEvent) {
  const top = open.at(-1);
  if (!top || event.key !== 'Escape' || isComposing(event)) return;
  event.preventDefault();
  top.close(true);
}

export function useLayer(active: boolean, layer: Layer) {
  const latest = useRef(layer);
  latest.current = layer;
  useEffect(() => {
    if (!active) return;
    const entry: Layer = { outside: (target) => latest.current.outside(target), close: (refocus) => latest.current.close(refocus) };
    if (open.length === 0) {
      document.addEventListener('pointerdown', press);
      document.addEventListener('keydown', key);
    }
    open.push(entry);
    return () => {
      open.splice(open.indexOf(entry), 1);
      if (open.length > 0) return;
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', key);
    };
  }, [active]);
}

const TAB_STOPS = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

// The focus moves into box when it opens and back to what had it when it closes; Tab and Shift+Tab go round
// inside it. Returns box's keydown handler.
export function useFocusTrap(box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => opener?.focus();
  }, [box]);
  return (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab' || !box.current) return;
    const stops = [...box.current.querySelectorAll<HTMLElement>(TAB_STOPS)];
    const edge = event.shiftKey ? stops[0] : stops.at(-1);
    if (document.activeElement !== edge) return;
    event.preventDefault();
    (event.shiftKey ? stops.at(-1) : stops[0])?.focus();
  };
}
