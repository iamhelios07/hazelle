// A piece of prompt text as the highlight layer draws it (MarkupArea). line: how its whole line reads, a `#`
// heading, a `---` rule or body text. mark: a CBS tag, the wrapper's {{slot}}, or an <angle> tag inside it.
export type Piece = { text: string; line: 'body' | 'heading' | 'rule'; mark: 'cbs' | 'slot' | 'angle' | null };

const HEADING = /^#{1,6}\s/;
const RULE = /^\s*-{3,}\s*$/;
const ANGLE = /^<\/?[A-Za-z][^<>\n]{0,60}>/;

// The pieces joined give back the text exactly, so the layer and the textarea above it wrap alike. A tag is read
// within its line, `{{` and `}}` nesting; one left open is plain text.
export function markup(text: string): Piece[] {
  const pieces: Piece[] = [];
  for (const whole of text.split(/(?<=\n)/)) {
    const line = HEADING.test(whole) ? 'heading' : RULE.test(whole) ? 'rule' : 'body';
    let plain = '';
    const push = (piece: string, mark: Piece['mark']) => {
      if (plain) pieces.push({ text: plain, line, mark: null });
      plain = '';
      pieces.push({ text: piece, line, mark });
    };
    const ends = closings(whole);
    let at = 0;
    while (at < whole.length) {
      const end = whole.startsWith('{{', at) ? ends[at + 2]! : -1;
      if (end !== -1) {
        const tag = whole.slice(at, end);
        push(tag, tag === '{{slot}}' ? 'slot' : 'cbs');
        at = end;
        continue;
      }
      const angle = whole[at] === '<' ? ANGLE.exec(whole.slice(at)) : null;
      if (angle) {
        push(angle[0], 'angle');
        at += angle[0].length;
        continue;
      }
      plain += whole[at];
      at += 1;
    }
    if (plain) pieces.push({ text: plain, line, mark: null });
  }
  return pieces;
}

// For each place in the line, where a tag open before it ends when read on from there: just past the `}}` that closes
// it, the tags opened on the way closed first, or -1 when the line ends first. Filled from the line's end back, each
// place from the ones after it, so a line of unclosed `{{` costs its length, not its square.
function closings(line: string): Int32Array {
  const ends = new Int32Array(line.length + 1).fill(-1);
  for (let at = line.length - 2; at >= 0; at--) {
    if (line.startsWith('}}', at)) ends[at] = at + 2;
    else if (line.startsWith('{{', at)) ends[at] = ends[at + 2] === -1 ? -1 : ends[ends[at + 2]!]!;
    else ends[at] = ends[at + 1]!;
  }
  return ends;
}
