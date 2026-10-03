import DOMPurify from 'dompurify';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useRowState } from '../collections/row-memory';
import styles from './Story.module.css';
import shadowCss from './Story.shadow.css?inline';

// One of the bot's buttons, as its HTML names it: risu-trigger names a function of its script, risu-btn carries data to it.
export type BotButton = { trigger: string } | { data: string };

type Props = {
  html: string;
  css?: string;
  cursor?: boolean;
  tone?: 'plain' | 'faded';
  buttons?: 'live' | 'inert';
  // A press on one of the bot's buttons; null for a plain button, which names nothing to run.
  onPress?: (button: BotButton | null) => void;
};

const NAMED = '[risu-trigger], [risu-btn]';
// Named in Story.shadow.css.
const PICTURE = 'data-picture';
const OPEN = 'data-open';
const PICTURES = Symbol('pictures');
const pictureKey = (picture: Element) => `${picture.getAttribute(PICTURE)}:${picture.querySelector('img')!.getAttribute('src')}`;
// Sent from a message when the reader opens or closes one of its pictures, so the chat keeps its view where it is.
export const READER_RESIZED = 'readerresized';
// The CSP refuses a style attribute, even in the document the sanitizer parses into, so each is renamed before the
// parse and applied through CSSOM, which the CSP allows.
const STYLE_ATTRIBUTE = /(<[a-z][^>]*?\s)style(?=\s*=)/gi;
const SET_ASIDE = 'data-style';
// No form: the CSP does not limit where one posts. DOMPurify's own URL rule, with blob: added for the bots' pictures;
// sanitize then keeps only the app's own sources and web links. No popover or command: either opens an element in
// the top layer, which no containment holds, without a script.
const CONFIG = {
  RETURN_DOM_FRAGMENT: true as const,
  FORBID_TAGS: ['form', 'style'],
  FORBID_ATTR: ['style', 'popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor'],
  ADD_ATTR: ['risu-btn', 'risu-trigger', 'risu-mark'],
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};
const VOID = new Set(['BR', 'HR', 'IMG', 'INPUT', 'WBR']);
// The look-ahead takes the spaces itself: \s* giving one back would let url( "blob:…" ) past it.
const OUTSIDE_URL = /url\((?![\s'"]*(?:data|blob):)[^)]*\)/gi;
// data: pictures, and blob: ones, which only the app itself can make: the chat puts its bots' pictures there.
const OWN_SOURCE = /^(?:data|blob):/;
const IMPORT = /@import[^;]*;?/gi;
const XLINK = 'http://www.w3.org/1999/xlink';

// For a stylesheet and a style attribute alike. Risu prefixes every class with x-risu- in the HTML and in the CSS, so
// a bot may write either, and both lose it. Only the app's own URLs load: the CSP refuses the others anyway, and a
// constructed stylesheet refuses @import.
const cleanCss = (css: string) => css.replaceAll('.x-risu-', '.').replace(IMPORT, '').replace(OUTSIDE_URL, 'none');

let base: CSSStyleSheet | null = null;
const sheets = new Map<string, CSSStyleSheet>();
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
  // Every element that follows a link: HTML's a and area, and SVG's a, whose address may be written as xlink:href.
  // That one is moved to href, which wins when both are written, so one attribute holds every link.
  for (const link of fragment.querySelectorAll('a, area')) {
    const href = link.getAttribute('href') ?? link.getAttributeNS(XLINK, 'href');
    link.removeAttributeNS(XLINK, 'href');
    if (href === null) continue;
    if (!/^https?:/i.test(href)) {
      link.removeAttribute('href');
    } else {
      link.setAttribute('href', href);
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
  for (const [index, block] of [...fragment.children].entries()) {
    const only = block.childElementCount === 1 && block.firstElementChild!.tagName === 'IMG' && !block.textContent!.trim();
    if (only && block.matches('p, .risu-inlay-image')) block.setAttribute(PICTURE, String(index));
  }
  if (cursor) {
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
export function Story({ html, css = '', cursor = false, tone = 'plain', buttons = 'inert', onPress }: Props) {
  const pictures = useRowState(PICTURES, () => new Set<string>());
  const host = useRef<HTMLDivElement>(null);
  const root = () => host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' });

  useLayoutEffect(() => {
    const fragment = sanitize(html, cursor);
    for (const picture of fragment.querySelectorAll(`[${PICTURE}]`)) {
      if (pictures?.has(pictureKey(picture))) picture.setAttribute(OPEN, '');
    }
    root().replaceChildren(fragment);
  }, [html, cursor, pictures]);

  useLayoutEffect(() => {
    if (!base) (base = new CSSStyleSheet()).replaceSync(shadowCss);
    root().adoptedStyleSheets = css ? [base, sheetFor(css)] : [base];
  }, [css]);

  useEffect(() => {
    const shadow = root();
    const press = (event: Event) => {
      const picture = (event.target as Element).closest(`[${PICTURE}]`);
      // A short picture, or one its character shows whole, has nothing to open, and a tap on it is the message's.
      if (picture && (picture.hasAttribute(OPEN) || picture.scrollHeight > picture.clientHeight)) {
        const opened = picture.toggleAttribute(OPEN);
        const source = pictureKey(picture);
        if (opened) pictures?.add(source);
        else pictures?.delete(source);
        event.preventDefault();
        return;
      }
      // The nearest element that names what to run: a plain button inside one is that one's press.
      const named = (event.target as Element).closest(NAMED);
      if (!named && !(event.target as Element).closest('button')) return;
      event.preventDefault();
      // An element with both is its trigger, as in Risu.
      const trigger = named?.getAttribute('risu-trigger') ?? null;
      onPress?.(trigger !== null ? { trigger } : named ? { data: named.getAttribute('risu-btn')! } : null);
    };
    // transitionend, not transitionstart: it lands in the frame of the new size, before that frame's resize observers.
    const resized = (event: Event) => {
      if ((event as TransitionEvent).propertyName !== 'max-height' || !(event.target as Element).hasAttribute(PICTURE)) return;
      host.current!.dispatchEvent(new Event(READER_RESIZED, { bubbles: true }));
    };
    shadow.addEventListener('click', press);
    shadow.addEventListener('transitionend', resized);
    return () => {
      shadow.removeEventListener('click', press);
      shadow.removeEventListener('transitionend', resized);
    };
  }, [onPress, pictures]);

  return (
    <div className={tone === 'faded' ? `${styles.story} ${styles.faded}` : styles.story}>
      <div ref={host} data-buttons={buttons}>{cursor && <span slot="cursor" className={styles.cursor} aria-hidden />}</div>
    </div>
  );
}
