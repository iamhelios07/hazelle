import DOMPurify from 'dompurify';
import { useEffect, useLayoutEffect, useRef } from 'react';
import styles from './Story.module.css';
import shadowCss from './Story.shadow.css?inline';

type Props = {
  // The engine's HTML for the text: markdown's, with a bot's own HTML where it was kept.
  html: string;
  // The bot's CSS for the chat.
  css?: string;
  // cursor marks a reply still streaming. faded: text that another will take the place of, such as a reply's
  // original while its translation is awaited.
  cursor?: boolean;
  tone?: 'plain' | 'faded';
  // A press on one of the bot's buttons, which nothing runs yet.
  onInert?: () => void;
};

const INERT = 'button, [risu-btn], [risu-trigger]';
// The CSP refuses a style attribute, even in the document the sanitizer parses into, so each is renamed before the
// parse and applied through CSSOM, which the CSP allows.
const STYLE_ATTRIBUTE = /(<[a-z][^>]*?\s)style(?=\s*=)/gi;
const SET_ASIDE = 'data-style';
// No form: the CSP does not limit where one posts. DOMPurify's own URL rule, with blob: added for the bots' pictures;
// sanitize then keeps only the app's own sources and web links.
const CONFIG = {
  RETURN_DOM_FRAGMENT: true as const,
  FORBID_TAGS: ['form', 'style'],
  FORBID_ATTR: ['style'],
  ADD_ATTR: ['risu-btn', 'risu-trigger', 'risu-mark'],
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};
const VOID = new Set(['BR', 'HR', 'IMG', 'INPUT', 'WBR']);
// The look-ahead takes the spaces itself: \s* giving one back would let url( "blob:…" ) past it.
const OUTSIDE_URL = /url\((?![\s'"]*(?:data|blob):)[^)]*\)/gi;
// data: pictures, and blob: ones, which only the app itself can make: the chat puts its bots' pictures there.
const OWN_SOURCE = /^(?:data|blob):/;
const IMPORT = /@import[^;]*;?/gi;

// For a stylesheet and a style attribute alike. Risu prefixes every class with x-risu- in the HTML and in the CSS, so
// a bot may write either, and both lose it. Only the app's own URLs load: the CSP refuses the others anyway, and a
// constructed stylesheet refuses @import.
const cleanCss = (css: string) => css.replaceAll('.x-risu-', '.').replace(IMPORT, '').replace(OUTSIDE_URL, 'none');

let base: CSSStyleSheet | null = null;
const sheets = new Map<string, CSSStyleSheet>();
// One sheet per CSS, shared by every message that shows it; the latest few are kept.
function sheetFor(css: string): CSSStyleSheet {
  let sheet = sheets.get(css);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cleanCss(css));
    sheets.set(css, sheet);
    if (sheets.size > 8) sheets.delete(sheets.keys().next().value!);
  }
  return sheet;
}

function sanitize(html: string, cursor: boolean): DocumentFragment {
  const fragment = DOMPurify.sanitize(html.replace(STYLE_ATTRIBUTE, `$1${SET_ASIDE}`), CONFIG);
  for (const element of fragment.querySelectorAll<HTMLElement | SVGElement>(`[${SET_ASIDE}]`)) {
    element.style.cssText = cleanCss(element.getAttribute(SET_ASIDE)!);
    element.removeAttribute(SET_ASIDE);
  }
  for (const element of fragment.querySelectorAll('[class]')) element.setAttribute('class', element.getAttribute('class')!.replace(/(^|\s)x-risu-/g, '$1'));
  for (const link of fragment.querySelectorAll('a[href]')) {
    if (!/^https?:/i.test(link.getAttribute('href')!)) {
      link.removeAttribute('href');
    } else {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  }
  for (const element of fragment.querySelectorAll('[src], [srcset]')) {
    const own = OWN_SOURCE.test(element.getAttribute('src') ?? '');
    if (element.tagName === 'IMG' && !own) element.remove();
    else if (!own) element.removeAttribute('src');
    element.removeAttribute('srcset');
  }
  if (cursor) {
    // At the end of the last text, inside whatever holds it.
    const last = (node: ParentNode) => {
      let child = node.lastChild;
      while (child instanceof Text && !child.data.trim()) child = child.previousSibling;
      return child;
    };
    let at: ParentNode = fragment;
    for (let child = last(at); child instanceof Element && !VOID.has(child.tagName); child = last(at)) at = child;
    if (at === fragment) at = fragment.appendChild(document.createElement('p'));
    const slot = document.createElement('slot');
    slot.name = 'cursor';
    at.append(slot);
  }
  return fragment;
}

// A message's text, drawn in a shadow root so a bot's HTML and CSS can never restyle or cover the app.
export function Story({ html, css = '', cursor = false, tone = 'plain', onInert }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const root = () => host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' });

  useLayoutEffect(() => {
    root().replaceChildren(sanitize(html, cursor));
  }, [html, cursor]);

  useLayoutEffect(() => {
    if (!base) (base = new CSSStyleSheet()).replaceSync(shadowCss);
    root().adoptedStyleSheets = css ? [base, sheetFor(css)] : [base];
  }, [css]);

  useEffect(() => {
    const shadow = root();
    const press = (event: Event) => {
      if (!(event.target as Element).closest(INERT)) return;
      event.preventDefault();
      onInert?.();
    };
    shadow.addEventListener('click', press);
    return () => shadow.removeEventListener('click', press);
  }, [onInert]);

  return (
    <div className={tone === 'faded' ? `${styles.story} ${styles.faded}` : styles.story}>
      <div ref={host}>{cursor && <span slot="cursor" className={styles.cursor} aria-hidden />}</div>
    </div>
  );
}
