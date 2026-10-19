import type { CodeSpan } from './codeLanguage';

export type Piece = { text: string; line: 'body' | 'heading' | 'rule'; mark: CodeSpan['kind'] | 'angle' | null };

const HEADING = /^#{1,6}\s/;
const RULE = /^\s*-{3,}\s*$/;
const ANGLE = /^<\/?[A-Za-z][^<>\n]{0,60}>/;
const ANGLE_MOST = 64;

// The pieces joined give back the text exactly, so the layer and the textarea above it wrap alike. spans: the text's
// tags as its language reads them, in order; an <angle> tag is marked only outside them.
export function markup(text: string, spans: readonly CodeSpan[]): Piece[] {
  const pieces: Piece[] = [];
  let next = 0;
  let start = 0;
  // Searched forward only, so a text with no `<` ahead is not scanned again on every line.
  let open = text.indexOf('<');
  for (const whole of text.split(/(?<=\n)/)) {
    const line = HEADING.test(whole) ? 'heading' : RULE.test(whole) ? 'rule' : 'body';
    const end = start + whole.length;
    let plain = '';
    let at = start;
    const push = (to: number, mark: Piece['mark']) => {
      if (plain) pieces.push({ text: plain, line, mark: null });
      plain = '';
      pieces.push({ text: text.slice(at, to), line, mark });
      at = to;
    };
    while (at < end) {
      while (next < spans.length && spans[next]!.to <= at) next += 1;
      const span = spans[next];
      if (span && span.from <= at) {
        push(Math.min(span.to, end), span.kind);
        continue;
      }
      const stop = span ? Math.min(span.from, end) : end;
      if (open !== -1 && open < at) open = text.indexOf('<', at);
      if (open === -1 || open >= stop) {
        plain += text.slice(at, stop);
        at = stop;
        continue;
      }
      plain += text.slice(at, open);
      at = open;
      const angle = ANGLE.exec(text.slice(open, Math.min(stop, open + ANGLE_MOST)));
      if (angle) {
        push(open + angle[0].length, 'angle');
      } else {
        plain += '<';
        at += 1;
      }
    }
    if (plain) pieces.push({ text: plain, line, mark: null });
    start = end;
  }
  return pieces;
}
