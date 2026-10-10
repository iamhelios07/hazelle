import { useEffect, useRef, useState } from 'react';

// A provider may send a reply in bursts, so a reply being written is revealed at a pace of its own: what has arrived
// and is not shown yet drains over about DRAIN_MS, never slower than FLOOR characters a second, and a burst spreads
// over the wait for the next one.
const DRAIN_MS = 1000;
const FLOOR = 30;

export function revealStep(shown: number, total: number, ms: number): number {
  const backlog = total - shown;
  if (backlog <= 0) return total;
  return Math.min(total, shown + Math.max((FLOOR * ms) / 1000, (backlog * ms) / DRAIN_MS));
}

// Revealing starts from the text the version had when it went live, so 이어 쓰기 does not type out the text it
// continues, and goes on after the reply ends until all of it is shown, so the last burst does not jump in.
export function useReveal(version: string, text: string, live: boolean): { text: string; revealing: boolean } {
  const [state, setState] = useState<{ version: string; shown: number } | null>(null);
  const length = useRef(text.length);
  length.current = text.length;
  const own = state?.version === version ? state : null;
  if (live && !own) setState({ version, shown: text.length });
  else if (!live && own && own.shown >= text.length) setState(null);
  const revealing = own !== null && own.shown < text.length;

  useEffect(() => {
    if (!revealing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const ms = now - last;
      last = now;
      setState((current) => current && { ...current, shown: revealStep(current.shown, length.current, ms) });
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [revealing]);

  if (!own) return { text, revealing: false };
  return { text: text.slice(0, revealCut(text, Math.floor(own.shown))), revealing };
}

// Never half of a surrogate pair, which would show as a broken character for a frame, and never inside a tag: a bare
// '<' or '</' left before a closing tag is text, which keeps a picture's line from being a picture line (Story), so the
// picture shows whole for a frame and folds again.
export function revealCut(text: string, cut: number): number {
  if (cut >= text.length) return cut;
  if (/[\uD800-\uDBFF]/.test(text[cut - 1] ?? '')) cut -= 1;
  const open = text.lastIndexOf('<', cut - 1);
  const inside = open >= 0 && /[A-Za-z/!]/.test(text[open + 1] ?? '') && !text.slice(open, cut).includes('>');
  return inside ? open : cut;
}
