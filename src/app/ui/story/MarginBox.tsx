import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Story, type BotButton } from './Story';
import styles from './MarginBox.module.css';

type Props = {
  html: string;
  css: string;
  buttons: 'live' | 'inert';
  onPress: (button: BotButton | null) => void;
  onFit: (fits: boolean) => void;
};

const LEAST = 0.5;
const PICTURE = new Set(['IMG', 'SVG', 'CANVAS', 'VIDEO', 'HR']);

// The wrappers bots centre a narrow card in are as wide as the story but draw nothing.
function drawn(element: HTMLElement): { left: number; right: number; bottom: number } | null {
  const root = element.firstElementChild?.firstElementChild?.shadowRoot;
  if (!root) return null;
  const origin = element.getBoundingClientRect();
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const take = (rect: DOMRect) => {
    if (!rect.width || !rect.height) return;
    left = Math.min(left, rect.left - origin.left);
    right = Math.max(right, rect.right - origin.left);
    bottom = Math.max(bottom, rect.bottom - origin.top);
  };
  for (const each of root.querySelectorAll('*')) {
    const style = getComputedStyle(each);
    const paints =
      PICTURE.has(each.tagName.toUpperCase()) ||
      style.backgroundImage !== 'none' ||
      !/^rgba\(.*,\s*0\)$|^transparent$/.test(style.backgroundColor) ||
      style.boxShadow !== 'none' ||
      ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none');
    if (paints) take(each.getBoundingClientRect());
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent!.trim()) continue;
    range.selectNodeContents(text);
    take(range.getBoundingClientRect());
  }
  return right > left ? { left, right, bottom } : null;
}

export function MarginBox({ html, css, buttons, onPress, onFit }: Props) {
  const room = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; width: number; left: number; right: number; bottom: number } | null>(null);
  // Measuring again for a new onFit, which callers make each render, would measure every render.
  const report = useRef(onFit);
  useLayoutEffect(() => {
    report.current = onFit;
  });

  useLayoutEffect(() => {
    const element = card.current!;
    const measure = () => {
      // Measured as laid out, not as drawn smaller.
      element.style.transform = 'none';
      const box = drawn(element);
      element.style.transform = '';
      const width = element.offsetWidth;
      const extent = box ?? { left: 0, right: width, bottom: element.offsetHeight };
      const scale = Math.min(1, room.current!.clientWidth / (extent.right - extent.left));
      setFit({ scale, width, ...extent });
      report.current(scale >= LEAST);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(room.current!);
    observer.observe(element);
    return () => observer.disconnect();
  }, [html, css]);

  const place = fit && {
    width: `${(fit.right - fit.left) * fit.scale}px`,
    height: `${fit.bottom * fit.scale}px`,
    '--scale': fit.scale,
    '--origin': `${fit.right}px`,
    '--shift': `${fit.width - fit.right}px`,
  };
  return (
    <div ref={room} className={styles.room}>
      <div className={styles.slot} style={place as CSSProperties}>
        <div ref={card} className={styles.card}>
          <Story html={html} css={css} buttons={buttons} onPress={onPress} />
        </div>
      </div>
    </div>
  );
}
