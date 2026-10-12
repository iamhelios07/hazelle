import DOMPurify from 'dompurify';
import { useEffect, useLayoutEffect, useReducer, useRef, type ReactNode } from 'react';
import { useRowState } from '../collections/row-memory';
import { scrollbarKind } from '../foundation/scrollbar';
import { useVeil, type Veil } from '../foundation/veil';
import { inlaid } from './inlay';
import { useMath } from './math';
import styles from './Story.module.css';
import shadowCss from './Story.shadow.css?inline';

// One of the bot's buttons, as its HTML names it: risu-trigger names a function of its script, risu-btn carries data to it.
// id: the trigger's element's risu-id, which {{triggerid}} reads; '' when it has none.
export type BotButton = { trigger: string; id: string } | { data: string };

type Props = {
  html: string;
  css?: string;
  cursor?: boolean;
  tone?: 'plain' | 'faded';
  buttons?: 'live' | 'inert';
  // A press on one of the bot's buttons; null for a plain button, which names nothing to run.
  onPress?: (button: BotButton | null) => void;
  // Lit wherever a text node holds it; lower case and NFC, as the caller's search folds it. '' for none.
  term?: string;
  // Every picture open, for a page drawn once where nothing can be tapped open (snapshot).
  whole?: boolean;
  // The message's 삽화, put where mark stands in html (inlaid), or at the end for a mark null.
  inlay?: { mark: string | null; node: ReactNode };
};

const NAMED = '[risu-trigger], [risu-btn]';
// Named in Story.shadow.css.
const PICTURE = 'data-picture';
const OPEN = 'data-open';
const PICTURES = Symbol('pictures');
// Named in Story.shadow.css. Holds the source of the picture it stands in for.
const VEILED = 'data-veiled';
// Named in Story.shadow.css and in engine/assets.ts (inlayMissing), whose mark stands where a chat's inlay is missing.
const INLAY_MISSING = 'data-inlay-missing';
const pictureKey = (picture: Element) => `${picture.getAttribute(PICTURE)}:${picture.querySelector('img')!.getAttribute('src')}`;
// Sent from a message when the reader opens or closes one of its pictures, so the chat keeps its view where it is.
export const READER_RESIZED = 'readerresized';
// The CSP refuses a style attribute, even in the document the sanitizer parses into, so each is renamed before the
// parse and applied through CSSOM, which the CSP allows.
const STYLE_ATTRIBUTE = /(<[a-z][^>]*?\s)style(?=\s*=)/gi;
const SET_ASIDE = 'data-style';
// No form: the CSP does not limit where one posts. DOMPurify's own URL rule, with blob: added for the bots' pictures;
// sanitize then keeps only the app's own sources and web links. No popover or command: either opens an element in
// the top layer, which no containment holds, without a script. KaTeX's MathML (math.ts) wraps a formula in semantics and
// its TeX in annotation, which DOMPurify drops by default while keeping their text: the TeX would show beside it.
const CONFIG = {
  RETURN_DOM_FRAGMENT: true as const,
  ADD_TAGS: ['semantics', 'annotation'],
  FORBID_TAGS: ['form', 'style'],
  FORBID_ATTR: ['style', 'popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor'],
  ADD_ATTR: ['risu-btn', 'risu-trigger', 'risu-id', 'risu-mark'],
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};
const VOID = new Set(['BR', 'HR', 'IMG', 'INPUT', 'WBR']);
const HTML = 'http://www.w3.org/1999/xhtml';
// The look-ahead takes the spaces itself: \s* giving one back would let url( "blob:…" ) past it.
const OUTSIDE_URL = /url\((?![\s'"]*(?:data|blob):)[^)]*\)/gi;
const ANY_URL = /url\([^)]*\)/gi;
// data: pictures, and blob: ones, which only the app itself can make: the chat puts its bots' pictures there.
const OWN_SOURCE = /^(?:data|blob):/;
const XLINK = 'http://www.w3.org/1999/xlink';
// Named in Story.shadow.css. One registry entry, which every mounted story adds its own ranges to.
const FOUND_TERM = 'found-term';
let foundTerm: Highlight | null = null;

// A term split across elements (he<em>llo</em>) is not lit, nor one in a node whose folding changes its length, where
// the offsets would lie; the message's own mark still shows it.
function termRanges(shadow: ShadowRoot, term: string): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(shadow, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.data.normalize('NFC').toLowerCase();
    if (text.length !== node.data.length) continue;
    for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
      const range = new Range();
      range.setStart(node, at);
      range.setEnd(node, at + term.length);
      ranges.push(range);
    }
  }
  return ranges;
}

// For a stylesheet and a style attribute alike. Risu prefixes every class with x-risu- in the HTML and in the CSS, so
// a bot may write either, and both lose it. Only the app's own URLs load: the CSP refuses the others anyway.
// While 이미지 가리기 is on, the app's own URLs go too: a bot draws its pictures as backgrounds as well.
// @import is left to the constructed stylesheet, which drops it. A pattern cut it at the first ;, which a font URL
// holds inside its quotes (wght@600;700), and the rest of the URL swallowed the bot's next rule.
export const cleanCss = (css: string, veiled: boolean) => css.replaceAll('.x-risu-', '.').replace(veiled ? ANY_URL : OUTSIDE_URL, 'none');

let base: CSSStyleSheet | null = null;
// The sheets a story's root holds besides the app's own.
export const botSheets = (shadow: ShadowRoot) => shadow.adoptedStyleSheets.filter((sheet) => sheet !== base);
const sheets = new Map<string, CSSStyleSheet>();
function sheetFor(css: string, veiled: boolean): CSSStyleSheet {
  const key = `${veiled}:${css}`;
  let sheet = sheets.get(key);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cleanCss(css, veiled));
    sheets.set(key, sheet);
    if (sheets.size > 8) sheets.delete(sheets.keys().next().value!);
  }
  return sheet;
}

function veilFor(source: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(VEILED, source);
  button.textContent = '이미지 보기';
  return button;
}

// The one mark inlaid left: a paragraph of its own becomes the slot, a mark inside the bot's HTML gives the slot its
// place; a mark the sanitizer took leaves the slot at the end.
function placeInlay(fragment: DocumentFragment, mark: string | null) {
  const slot = document.createElement('slot');
  slot.name = 'inlay';
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node && mark; node = walker.nextNode() as Text | null) {
    const at = node.data.indexOf(mark);
    if (at === -1) continue;
    const block = node.parentElement;
    if (block?.tagName === 'P' && block.textContent === mark) return block.replaceWith(slot);
    const rest = node.splitText(at);
    rest.data = rest.data.slice(mark.length);
    return rest.before(slot);
  }
  fragment.append(slot);
}

function sanitize(html: string, cursor: boolean, veil: Veil | null): DocumentFragment {
  const fragment = DOMPurify.sanitize(html.replace(STYLE_ATTRIBUTE, `$1${SET_ASIDE}`), CONFIG);
  for (const element of fragment.querySelectorAll<HTMLElement | SVGElement>(`[${SET_ASIDE}]`)) {
    element.style.cssText = cleanCss(element.getAttribute(SET_ASIDE)!, veil !== null);
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
    const source = element.getAttribute('src') ?? '';
    const own = OWN_SOURCE.test(source);
    if (element.tagName !== 'IMG') {
      if (!own || veil) element.removeAttribute('src');
    } else if (!own) {
      element.remove();
    } else if (veil && !veil.revealed.has(source)) {
      element.replaceWith(veilFor(source));
    }
    element.removeAttribute('srcset');
  }
  // The other ways HTML draws a picture, none of which a veil opens: SVG's image and feImage, a video's poster, the
  // old background attribute. An SVG href to its own #part is not a picture.
  if (veil) {
    for (const element of fragment.querySelectorAll('[*|href]:not(a, area)')) {
      if (!OWN_SOURCE.test(element.getAttribute('href') ?? element.getAttributeNS(XLINK, 'href') ?? '')) continue;
      element.removeAttribute('href');
      element.removeAttributeNS(XLINK, 'href');
    }
    for (const element of fragment.querySelectorAll('[background], [poster]')) {
      element.removeAttribute('background');
      element.removeAttribute('poster');
    }
  }
  for (const missing of fragment.querySelectorAll(`[${INLAY_MISSING}]`)) missing.textContent = '옮기지 못한 이미지';
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
    // Not into SVG or MathML, where an HTML slot draws nothing.
    for (let child = last(at); child instanceof Element && child.namespaceURI === HTML && !VOID.has(child.tagName); child = last(at)) at = child;
    if (at === fragment) at = fragment.appendChild(document.createElement('p'));
    const slot = document.createElement('slot');
    slot.name = 'cursor';
    at.append(slot);
  }
  return fragment;
}

// A message's text, drawn in a shadow root so a bot's HTML and CSS can never restyle or cover the app.
export function Story({ html, css = '', cursor = false, tone = 'plain', buttons = 'inert', onPress, term = '', whole = false, inlay }: Props) {
  const pictures = useRowState(PICTURES, () => new Set<string>());
  const veil = useVeil();
  // A tapped veil changes only veil.revealed, which no render sees.
  const [reveals, reveal] = useReducer((count: number) => count + 1, 0);
  const host = useRef<HTMLDivElement>(null);
  const root = () => host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' });

  const placed = inlay !== undefined;
  const mark = inlay?.mark ?? null;
  const math = useMath(html);
  useLayoutEffect(() => {
    const marked = mark ? inlaid(html, mark, mark) : html;
    const fragment = sanitize(math ? math(marked) : marked, cursor, veil);
    for (const picture of fragment.querySelectorAll(`[${PICTURE}]`)) {
      if (whole || pictures?.has(pictureKey(picture))) picture.setAttribute(OPEN, '');
    }
    // After the cursor, which would otherwise go into the slot.
    if (placed) placeInlay(fragment, mark);
    root().replaceChildren(fragment);
  }, [html, cursor, pictures, veil, reveals, whole, placed, mark, math]);

  // After the text is drawn, which drops every range made over the text before. Without the API, nothing is lit.
  useEffect(() => {
    if (!term || !('highlights' in CSS)) return;
    if (!foundTerm) CSS.highlights.set(FOUND_TERM, (foundTerm = new Highlight()));
    const lit = foundTerm;
    const ranges = termRanges(root(), term);
    for (const range of ranges) lit.add(range);
    return () => {
      for (const range of ranges) lit.delete(range);
    };
  }, [html, cursor, pictures, veil, reveals, term, placed, mark, math]);

  useLayoutEffect(() => {
    if (!base) (base = new CSSStyleSheet()).replaceSync(shadowCss);
    root().adoptedStyleSheets = css ? [base, sheetFor(css, veil !== null)] : [base];
  }, [css, veil]);

  useEffect(() => {
    const shadow = root();
    const press = (event: Event) => {
      // The inlay's own controls are the app's, slotted in from outside the root, and never a bot's button.
      if (!shadow.contains(event.target as Node)) return;
      const veiled = (event.target as Element).closest(`[${VEILED}]`);
      if (veiled && veil) {
        veil.revealed.add(veiled.getAttribute(VEILED)!);
        reveal();
        event.preventDefault();
        return;
      }
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
      onPress?.(trigger !== null ? { trigger, id: named!.getAttribute('risu-id') ?? '' } : named ? { data: named.getAttribute('risu-btn')! } : null);
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
  }, [onPress, pictures, veil]);

  return (
    <div className={tone === 'faded' ? `${styles.story} ${styles.faded}` : styles.story}>
      <div ref={host} data-buttons={buttons} data-scrollbars={scrollbarKind()}>
        {cursor && <span slot="cursor" className={styles.cursor} aria-hidden />}
        {inlay && <div slot="inlay">{inlay.node}</div>}
      </div>
    </div>
  );
}
