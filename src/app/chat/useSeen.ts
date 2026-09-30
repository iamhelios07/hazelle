import { useState } from 'react';

// Which of the status window's boxes drawn in the messages are on screen, by script, so the tab at the story's edge
// shows only while one is not. watch gives one ref per script that lasts, so a render does not watch again.
export function useSeen() {
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set());
  const [{ watch }] = useState(() => {
    const change = (script: number, on: boolean) =>
      setSeen((current) => (current.has(script) === on ? current : new Set(on ? [...current, script] : [...current].filter((each) => each !== script))));
    const scripts = new WeakMap<Element, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) change(scripts.get(entry.target)!, entry.isIntersecting);
    });
    const refs = new Map<number, (element: HTMLElement | null) => (() => void) | undefined>();
    return {
      watch: (script: number) => {
        let ref = refs.get(script);
        if (!ref) {
          // A ref that returns a cleanup is never called with null; its type still says it may be.
          ref = (element) => {
            if (!element) return;
            scripts.set(element, script);
            observer.observe(element);
            return () => {
              observer.unobserve(element);
              change(script, false);
            };
          };
          refs.set(script, ref);
        }
        return ref;
      },
    };
  });
  return { seen, watch };
}
