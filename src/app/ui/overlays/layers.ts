import { useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { isComposing } from '../foundation/keys';

type Layer = {
  outside: (target: Node) => boolean;
  // refocus: closed by Esc, so the focus goes back to where the layer was opened. A press outside leaves the
  // focus where it pressed.
  close: (refocus: boolean) => void;
};

// Every open menu, dialog and pinned hint, newest last. Esc and a press outside reach the newest one only, so Esc in a menu
// over a dialog closes the menu and leaves the dialog open. These are the kit's only document listeners for keys
// and presses: a component adding its own would reach every layer again.
const open: Layer[] = [];

function press(event: PointerEvent) {
  const top = open.at(-1);
  if (top?.outside(event.target as Node)) top.close(false);
}

// An Esc a focused field already took (응답 멈추기 in the composer, 수정 취소 in the edit box) closes nothing: one
// press does one thing.
function key(event: KeyboardEvent) {
  const top = open.at(-1);
  if (!top || event.key !== 'Escape' || event.defaultPrevented || isComposing(event)) return;
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

// The sides a popover must stay within: the nearest box that clips it, such as a list column that scrolls, inside the
// screen. The screen alone is not enough: a menu inside a column is cut off at the column's side, top or bottom.
export function room(element: HTMLElement) {
  let left = 0;
  let top = 0;
  let right = document.documentElement.clientWidth;
  let bottom = window.innerHeight;
  for (let at = element.parentElement; at; at = at.parentElement) {
    if (getComputedStyle(at).overflowX === 'visible') continue;
    const box = at.getBoundingClientRect();
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
    break;
  }
  return { left, top, right, bottom };
}

export function keepOnScreen(element: HTMLElement) {
  // Measured unshifted: --nudge inherits, so a popover inside another would otherwise start from the outer one's shift.
  element.style.setProperty('--nudge', '0px');
  const box = element.getBoundingClientRect();
  const edge = parseFloat(getComputedStyle(element).getPropertyValue('--menu-edge'));
  const { left, right } = room(element);
  const shift = box.left < left + edge ? left + edge - box.left : box.right > right - edge ? right - edge - box.right : 0;
  element.style.setProperty('--nudge', `${shift}px`);
}

// A popover on the body at a fixed spot by its anchor, so a dialog's or panel's scrolling box cannot clip it. Its
// stylesheet places it on one side with --anchor-left and --anchor-below (the anchor's bottom) or --anchor-above (its top,
// from the window's bottom), and on the other under [data-flipped], set where the first side runs off the screen. It
// does not follow a scroll, so any scroll closes it.
export function useAnchored(open: boolean, popover: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null>, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  useLayoutEffect(() => {
    const element = popover.current;
    const at = anchor.current?.getBoundingClientRect();
    if (!open || !element || !at) return;
    element.style.setProperty('--anchor-left', `${at.left}px`);
    element.style.setProperty('--anchor-below', `${at.bottom}px`);
    element.style.setProperty('--anchor-above', `${window.innerHeight - at.top}px`);
    keepOnScreen(element);
    delete element.dataset.flipped;
    const box = element.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) element.dataset.flipped = '';
  }, [open, popover, anchor]);
  useEffect(() => {
    if (!open) return;
    const scrolled = () => latest.current();
    window.addEventListener('scroll', scrolled, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', scrolled, { capture: true });
  }, [open]);
}

export const TAB_STOPS = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('input, textarea, button');
    first?.focus();
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
