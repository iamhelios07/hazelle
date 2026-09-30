import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Story } from './Story';
import styles from './PinnedBox.module.css';

type Props = {
  // The script that draws it, as the bot named it.
  name: string;
  actions: ReactNode;
  // null: the box was never drawn yet in this chat.
  html: string | null;
  css: string;
  onInert: () => void;
};

// A bot's box pinned beside the story (옆에 고정). Boxes are built for about the story's width, wider than the panel,
// so a wider one is drawn smaller until it fits.
export function PinnedBox({ name, actions, html, css, onInert }: Props) {
  const body = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = body.current;
    const box = element?.firstElementChild;
    if (!(box instanceof HTMLElement)) return;
    // Measured whole, then shrunk: a box laid out at the smaller size would reflow to fit instead. The story clips
    // what overflows it (Story's containment), so the width is its drawn elements' furthest edge, not scrollWidth.
    const fit = () => {
      box.style.zoom = '1';
      const left = box.getBoundingClientRect().left;
      const drawn = [...(box.firstElementChild?.shadowRoot?.querySelectorAll('*') ?? [])].reduce((right, each) => Math.max(right, each.getBoundingClientRect().right - left), 0);
      box.style.zoom = String(Math.min(1, element!.clientWidth / Math.max(drawn, 1)));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element!);
    return () => observer.disconnect();
  }, [html, css]);

  return (
    <section className={styles.box} aria-label={name}>
      <div className={styles.head}>
        <h3 className={styles.name}>{name}</h3>
        {actions}
      </div>
      {html === null ? (
        <p className={styles.none}>이 채팅에서 아직 그린 적이 없어요.</p>
      ) : (
        <div ref={body} className={styles.body}>
          <Story html={html} css={css} onInert={onInert} />
        </div>
      )}
    </section>
  );
}
