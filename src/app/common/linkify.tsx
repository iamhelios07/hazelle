import type { ReactNode } from 'react';
import { Link } from '../ui';

const URL = /https?:\/\/[^\s<>"']+/g;
// Punctuation that ends a sentence after an address rather than belonging to it; a ) only when the address opened none.
const TRAILING = /[.,!?;:]+$/;

export type Piece = { text: string; href?: string };

export function splitLinks(text: string): Piece[] {
  const pieces: Piece[] = [];
  let from = 0;
  for (const match of text.matchAll(URL)) {
    let href = match[0].replace(TRAILING, '');
    if (href.endsWith(')') && !href.includes('(')) href = href.slice(0, -1).replace(TRAILING, '');
    if (match.index > from) pieces.push({ text: text.slice(from, match.index) });
    pieces.push({ text: href, href });
    from = match.index + href.length;
  }
  if (from < text.length) pieces.push({ text: text.slice(from) });
  return pieces;
}

// Plain text with its web addresses as links, for a Text whose line breaks stay.
export const linkify = (text: string): ReactNode[] =>
  splitLinks(text).map((piece, index) => (piece.href ? <Link key={index} href={piece.href}>{piece.text}</Link> : piece.text));
